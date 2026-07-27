import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { hashPassword } from '../../common/passwords';
import { AuthService } from '../auth/auth.service';
import { PlatformDb } from './platform.db';
import { PlatformActionsService } from './platform-actions.service';
import type { PlatformActor, PlatformRole } from './platform-session';

/**
 * Acciones del panel — FASE 2.
 *
 * Lo que se prueba no es «cambia la columna», que es lo fácil. Es que la acción TENGA EFECTO: que
 * suspender realmente deje afuera a la finca, que corte las sesiones vivas, que el motivo quede en
 * la bitácora dentro de la misma transacción, y que un rol que no corresponde no pueda ejecutarla.
 *
 * Antes de esta fase, `organizations.status` era una columna que no leía nadie: el botón habría
 * cambiado un dato y nada más.
 */
describe('platform — acciones sobre cuentas (fase 2)', () => {
  let db: DbService;
  let pdb: PlatformDb;
  let acciones: PlatformActionsService;
  let auth: AuthService;
  let originalCwd: string;
  let tmp: string;

  let tenant: string;
  let ownerUser: string;
  let ownerEmail: string;

  const actor = (role: PlatformRole = 'superadmin'): PlatformActor => ({
    userId: '00000000-0000-0000-0000-0000000000aa',
    role,
    email: `${role}@cowinance.com`,
    name: 'Admin de plataforma',
    mfa: false,
  });

  const MOTIVO = 'falta de pago de la factura 1042';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'platform-acc-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    pdb = new PlatformDb(db);
    acciones = new PlatformActionsService(pdb);
    auth = new AuthService(db);

    tenant = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    const u = (
      await db.query<{ user_id: string }>(`SELECT user_id FROM user_role_assignments WHERE tenant_id = $1 LIMIT 1`, [tenant])
    )[0];
    ownerUser = u.user_id;
    ownerEmail = (await db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [ownerUser]))[0].email;
    // Contraseña conocida, para poder ejercer el login de verdad.
    await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [ownerUser, await hashPassword('clave-de-prueba')]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const login = () => auth.login({ email: ownerEmail, password: 'clave-de-prueba' });

  // ── Suspender: la prueba que da sentido a toda la fase ───────────────────────────────────────

  it('suspender DEJA AFUERA a la finca: el login deja de funcionar', async () => {
    // Antes: entra normal.
    await expect(login()).resolves.toMatchObject({ token_type: 'Bearer' });

    const r = await acciones.suspendOrganization(actor(), tenant, { reason: MOTIVO });
    expect(r.status).toBe('suspended');
    expect(r.previous_status).toBe('active');

    // Después: NO entra. Éste es el punto entero — sin el control en `auth`, el botón mentiría.
    await expect(login()).rejects.toMatchObject({ status: 401 });
    const err = await login().catch((e) => e);
    expect(err.response.code).toBe('auth.organization_suspended');
  });

  it('suspender CORTA las sesiones vivas, no espera a que venzan solas', async () => {
    await acciones.reactivateOrganization(actor(), tenant, { reason: 'se regularizó el pago pendiente' });
    const sesion = await login();

    const r = await acciones.suspendOrganization(actor(), tenant, { reason: MOTIVO });
    expect(r.revoked_sessions).toBeGreaterThanOrEqual(1);

    // El refresh token queda revocado: sin esto la finca seguiría renovando su sesión hasta 7 días.
    await expect(auth.refresh({ refresh_token: sesion.refresh_token })).rejects.toMatchObject({ status: 401 });
  });

  it('reactivar la deja entrar de nuevo', async () => {
    const r = await acciones.reactivateOrganization(actor(), tenant, { reason: 'se regularizó el pago pendiente' });
    expect(r.status).toBe('active');
    await expect(login()).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it('suspender dos veces es 409, no un éxito silencioso', async () => {
    await acciones.suspendOrganization(actor(), tenant, { reason: MOTIVO });
    await expect(acciones.suspendOrganization(actor(), tenant, { reason: MOTIVO })).rejects.toMatchObject({ status: 409 });
    await acciones.reactivateOrganization(actor(), tenant, { reason: 'se regularizó el pago pendiente' });
  });

  // ── Motivo y bitácora ────────────────────────────────────────────────────────────────────────

  it('sin motivo no hay acción, y el estado NO cambia', async () => {
    await expect(acciones.suspendOrganization(actor(), tenant, {})).rejects.toMatchObject({ status: 400 });
    await expect(acciones.suspendOrganization(actor(), tenant, { reason: 'ok' })).rejects.toMatchObject({ status: 400 });
    const [org] = await db.query<{ status: string }>(`SELECT status FROM organizations WHERE id = $1`, [tenant]);
    expect(org.status).toBe('active');
  });

  it('la bitácora guarda quién, qué, por qué y el estado anterior', async () => {
    await acciones.suspendOrganization(actor('billing'), tenant, { reason: MOTIVO });
    const [log] = await pdb.read((q) =>
      q.query<any>(
        `SELECT actor_role, action, target_tenant_id, detail FROM platform_audit_logs
          WHERE action = 'organization.suspend' ORDER BY occurred_at DESC LIMIT 1`,
      ),
    );
    expect(log.actor_role).toBe('billing');
    expect(log.target_tenant_id).toBe(tenant);
    expect(log.detail.motivo).toBe(MOTIVO);
    expect(log.detail.estado_anterior).toBe('active');
    expect(log.detail.estado_nuevo).toBe('suspended');
    expect(log.detail.sesiones_revocadas).toBeGreaterThanOrEqual(0);
    await acciones.reactivateOrganization(actor(), tenant, { reason: 'se regularizó el pago pendiente' });
  });

  // ── Roles ────────────────────────────────────────────────────────────────────────────────────

  it('cada rol solo ejecuta lo suyo; auditor no ejecuta nada', async () => {
    await expect(acciones.suspendOrganization(actor('support'), tenant, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
    await expect(acciones.blockUser(actor('billing'), ownerUser, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
    await expect(acciones.suspendOrganization(actor('auditor'), tenant, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
    await expect(acciones.blockUser(actor('auditor'), ownerUser, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
  });

  it('el rechazo por rol ocurre ANTES de tocar nada', async () => {
    const antes = await db.query<{ status: string }>(`SELECT status FROM organizations WHERE id = $1`, [tenant]);
    await expect(acciones.suspendOrganization(actor('auditor'), tenant, { reason: MOTIVO })).rejects.toMatchObject({ status: 403 });
    const despues = await db.query<{ status: string }>(`SELECT status FROM organizations WHERE id = $1`, [tenant]);
    expect(despues[0].status).toBe(antes[0].status);
  });

  // ── Usuarios ─────────────────────────────────────────────────────────────────────────────────

  it('bloquear un usuario le corta el acceso y las sesiones', async () => {
    const sesion = await login();
    const r = await acciones.blockUser(actor('support'), ownerUser, { reason: 'cuenta comprometida, reportada por el titular' });
    expect(r.status).toBe('blocked');
    expect(r.revoked_sessions).toBeGreaterThanOrEqual(1);

    await expect(login()).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh({ refresh_token: sesion.refresh_token })).rejects.toMatchObject({ status: 401 });

    await acciones.unblockUser(actor('support'), ownerUser, { reason: 'se verificó la identidad del titular' });
    await expect(login()).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it('un administrador no puede bloquearse a sí mismo y quedar afuera del panel', async () => {
    const yo = actor('superadmin');
    await expect(acciones.blockUser(yo, yo.userId, { reason: 'prueba de bloqueo propio del panel' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('id inexistente da 404', async () => {
    const cero = '00000000-0000-0000-0000-000000000000';
    await expect(acciones.suspendOrganization(actor(), cero, { reason: MOTIVO })).rejects.toMatchObject({ status: 404 });
    await expect(acciones.blockUser(actor(), cero, { reason: MOTIVO })).rejects.toMatchObject({ status: 404 });
  });

  // ── Plan ─────────────────────────────────────────────────────────────────────────────────────

  it('cambiar de plan actualiza la suscripción y NO genera cobro', async () => {
    const trial = (await db.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'trial'`))[0].id;
    await db.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, billing_currency, current_period_start, current_period_end)
       VALUES ($1,$2,'trialing','USD', CURRENT_DATE, CURRENT_DATE + 30)`,
      [tenant, trial],
    );

    const pagosAntes = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_payments`);
    const r = await acciones.changePlan(actor('billing'), tenant, { plan_code: 'pro', reason: 'el cliente pidió subir de plan' });
    expect(r.plan.code).toBe('pro');
    expect(r.previous_plan).toBe('trial');

    const [sub] = await db.query<{ code: string }>(
      `SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
      [tenant],
    );
    expect(sub.code).toBe('pro');

    // La fase 2 no toca dinero: la cantidad de pagos no se mueve.
    const pagosDespues = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_payments`);
    expect(pagosDespues[0].n).toBe(pagosAntes[0].n);
  });

  it('el mismo plan es 409, y un plan inexistente 404', async () => {
    await expect(acciones.changePlan(actor('billing'), tenant, { plan_code: 'pro', reason: MOTIVO })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      acciones.changePlan(actor('billing'), tenant, { plan_code: 'no-existe', reason: MOTIVO }),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ── La barrera que sigue en pie ──────────────────────────────────────────────────────────────

  it('la policy de escritura alcanza SOLO a subscriptions; el resto sigue en FOR SELECT', async () => {
    const rows = await db.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies WHERE schemaname='public' AND policyname='platform_write'`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['subscriptions']);
    expect(rows[0].cmd).toBe('UPDATE');

    // billing_payments y animals NO tienen policy de escritura para el panel: el motor lo deniega
    // aunque alguien agregue el endpoint.
    const escribibles = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname='public' AND policyname='platform_write' AND tablename IN ('billing_payments','animals','files','farms')`,
    );
    expect(escribibles[0].n).toBe(0);
  });
});
