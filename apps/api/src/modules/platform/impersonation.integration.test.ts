import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../../db/db.service';
import { JWT_ISSUER, JWT_SECRET } from '../auth/auth.service';
import { PlatformDb } from './platform.db';
import { PlatformActionsService } from './platform-actions.service';
import { IMPERSONATION_TTL_S, impersonationOf, signImpersonationToken } from './impersonation';
import { verifyPlatformToken } from './platform-session';
import type { PlatformActor, PlatformRole } from './platform-session';

/**
 * MODO ESPEJO.
 *
 * Lo que hay que demostrar no es que el token se emita, sino que las cuatro restricciones se
 * sostienen: que es una sesión del ERP (si no, no sirve para reproducir el problema del cliente),
 * que dura poco, que se puede atribuir a quien entró, y —la que importa— que **no puede escribir**.
 *
 * Esa última se prueba contra el motor, no contra un `if`: la transacción va READ ONLY, así que
 * cualquier escritura falla venga del endpoint que venga. Es la única forma de estar seguro en un
 * sistema donde varios `GET` escriben (alertas read-through, contador de notificaciones, trial).
 */
describe('platform — modo espejo (impersonation)', () => {
  let db: DbService;
  let pdb: PlatformDb;
  let acciones: PlatformActionsService;
  let originalCwd: string;
  let tmp: string;

  let tenant: string;
  let ownerUser: string;

  const actor = (role: PlatformRole = 'support'): PlatformActor => ({
    userId: '00000000-0000-0000-0000-0000000000aa',
    role,
    email: `${role}@cowinance.com`,
    name: 'Soporte',
    mfa: false,
  });

  const MOTIVO = 'el cliente reporta que no ve sus pesadas';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'platform-imp-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    pdb = new PlatformDb(db);
    acciones = new PlatformActionsService(pdb);

    tenant = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    ownerUser = (
      await db.query<{ user_id: string }>(`SELECT user_id FROM user_role_assignments WHERE tenant_id = $1 LIMIT 1`, [tenant])
    )[0].user_id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Forma del token ──────────────────────────────────────────────────────────────────────────

  it('es una sesión del ERP: la verifica la clave del ERP, con el tenant y el rol reales del usuario', async () => {
    const r = await acciones.impersonate(actor(), ownerUser, { reason: MOTIVO });
    const payload = jwt.verify(r.token, JWT_SECRET, { issuer: JWT_ISSUER }) as any;

    expect(payload.typ).toBe('impersonation');
    expect(payload.sub).toBe(ownerUser);
    expect(payload.ten).toBe(tenant);
    // El rol es el que tiene el usuario de verdad: si fuera otro, el soporte vería una app distinta
    // de la del cliente y no serviría para reproducir su problema.
    expect(payload.role).toBe('owner');
    expect(r.read_only).toBe(true);
    expect(r.expires_in).toBe(IMPERSONATION_TTL_S);
  });

  it('lleva quién entró: no se disfraza del cliente', async () => {
    const r = await acciones.impersonate(actor('support'), ownerUser, { reason: MOTIVO });
    const payload = jwt.verify(r.token, JWT_SECRET, { issuer: JWT_ISSUER }) as any;
    const imp = impersonationOf(payload)!;
    expect(imp.by).toBe(actor().userId);
    expect(imp.by_email).toBe('support@cowinance.com');
    expect(imp.by_role).toBe('support');
    expect(imp.sid).toBe(r.sid);
  });

  it('dura 10 minutos, no lo que dura una sesión normal', async () => {
    const r = await acciones.impersonate(actor(), ownerUser, { reason: MOTIVO });
    const payload = jwt.verify(r.token, JWT_SECRET, { issuer: JWT_ISSUER }) as any;
    expect(payload.exp - payload.iat).toBe(600);
  });

  it('NO vale como sesión del panel de plataforma', () => {
    const { token } = signImpersonationToken(
      { id: ownerUser, full_name: 'X', email: 'x@y.z' },
      tenant,
      'owner',
      { by: 'a', by_email: 'a@b.c', by_role: 'support' },
    );
    // Firmado con la clave del ERP: contra la derivada del panel ni siquiera valida.
    expect(verifyPlatformToken(token)).toBeNull();
  });

  it('un token de acceso normal NO tiene claim de espejo (no hay falsos positivos)', () => {
    const normal = jwt.sign(
      { sub: ownerUser, ten: tenant, role: 'owner', name: 'X', email: 'x@y.z', typ: 'access' },
      JWT_SECRET,
      { issuer: JWT_ISSUER, expiresIn: 900 },
    );
    expect(impersonationOf(jwt.verify(normal, JWT_SECRET, { issuer: JWT_ISSUER }) as any)).toBeNull();
  });

  // ── Permisos y estado ────────────────────────────────────────────────────────────────────────

  it('solo superadmin y support pueden; billing y auditor no', async () => {
    await expect(acciones.impersonate(actor('superadmin'), ownerUser, { reason: MOTIVO })).resolves.toBeTruthy();
    await expect(acciones.impersonate(actor('billing'), ownerUser, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
    await expect(acciones.impersonate(actor('auditor'), ownerUser, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
  });

  it('exige motivo, como toda acción del panel', async () => {
    await expect(acciones.impersonate(actor(), ownerUser, {})).rejects.toMatchObject({ status: 400 });
  });

  it('no se puede entrar como un usuario bloqueado', async () => {
    await db.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [ownerUser]);
    await expect(acciones.impersonate(actor(), ownerUser, { reason: MOTIVO })).rejects.toMatchObject({ status: 409 });
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerUser]);
  });

  it('no se puede entrar como un usuario sin organización: no hay finca que mirar', async () => {
    const [huerfano] = await db.query<{ id: string }>(
      `INSERT INTO users (email, full_name, password_hash) VALUES ('sin-finca@example.com','Sin Finca','x') RETURNING id`,
    );
    await expect(acciones.impersonate(actor(), huerfano.id, { reason: MOTIVO })).rejects.toMatchObject({ status: 409 });
  });

  // ── Bitácora ─────────────────────────────────────────────────────────────────────────────────

  it('el inicio queda registrado con motivo, finca y sid; el token NO se guarda', async () => {
    const r = await acciones.impersonate(actor(), ownerUser, { reason: MOTIVO });
    const [log] = await pdb.read((q) =>
      q.query<any>(
        `SELECT actor_email, action, target_tenant_id, detail FROM platform_audit_logs
          WHERE action = 'user.impersonate' ORDER BY occurred_at DESC LIMIT 1`,
      ),
    );
    expect(log.action).toBe('user.impersonate');
    expect(log.target_tenant_id).toBe(tenant);
    expect(log.detail.motivo).toBe(MOTIVO);
    expect(log.detail.sid).toBe(r.sid);
    // La bitácora existe para poder auditar, no para juntar llaves de las fincas.
    expect(JSON.stringify(log)).not.toContain(r.token);
  });

  it('el cierre se registra con el mismo sid, para saber hasta cuándo estuvo adentro', async () => {
    const r = await acciones.impersonate(actor(), ownerUser, { reason: MOTIVO });
    await acciones.endImpersonation(actor(), { sid: r.sid });
    const [fin] = await pdb.read((q) =>
      q.query<any>(
        `SELECT action, detail FROM platform_audit_logs WHERE action = 'user.impersonate.end'
          ORDER BY occurred_at DESC LIMIT 1`,
      ),
    );
    expect(fin.detail.sid).toBe(r.sid);
    await expect(acciones.endImpersonation(actor(), {})).rejects.toMatchObject({ status: 400 });
  });

  // ── LA restricción: solo lectura impuesta por el motor ───────────────────────────────────────

  it('en una transacción READ ONLY, escribir falla — y el error se traduce a 403, no a 500', async () => {
    // Se ejerce el MISMO mecanismo que usa el interceptor: marcar la tx y después intentar escribir.
    // No se prueba «el endpoint X está bloqueado» porque eso solo cubriría ese endpoint; acá se
    // prueba la barrera que los cubre a todos.
    const intento = db.tx(async (q) => {
      await q.query(`SET TRANSACTION READ ONLY`);
      // Una escritura cualquiera del ERP: si ésta pasa, cualquiera pasa.
      await q.query(`UPDATE organizations SET name = 'tocada en modo espejo' WHERE id = $1`, [tenant]);
    });
    await expect(intento).rejects.toMatchObject({ status: 403 });
    const err = await intento.catch((e) => e);
    expect(err.response.code).toBe('impersonation.read_only');

    // Y no cambió nada.
    const [org] = await db.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [tenant]);
    expect(org.name).not.toBe('tocada en modo espejo');
  });

  it('leer SÍ funciona: el espejo sirve para mirar', async () => {
    const filas = await db.tx(async (q) => {
      await q.query(`SET TRANSACTION READ ONLY`);
      return q.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals WHERE tenant_id = $1`, [tenant]);
    });
    expect(filas[0].n).toBeGreaterThan(0);
  });

  it('la barrera alcanza también a las escrituras de los GET read-through (alertas, ledger, trial)', async () => {
    // Este sistema tiene `GET` que escriben. Un guard por método HTTP los habría dejado pasar
    // creyendo que bloqueaba las escrituras; la transacción de solo lectura no.
    const intento = db.tx(async (q) => {
      await q.query(`SET TRANSACTION READ ONLY`);
      await q.query(
        `INSERT INTO alerts (tenant_id, category, severity, title, status, triggered_at)
         VALUES ($1,'sanidad','info','alerta de prueba','open', now())`,
        [tenant],
      );
    });
    await expect(intento).rejects.toMatchObject({ status: 403 });
  });
});
