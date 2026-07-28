import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { hashPassword } from '../../common/passwords';
import { PlatformDb } from './platform.db';
import { PlatformService } from './platform.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { JWT_ISSUER, JWT_SECRET } from '../auth/auth.service';
import { PLATFORM_JWT_SECRET, signPlatformToken, verifyPlatformToken } from './platform-session';
import * as jwt from 'jsonwebtoken';

/**
 * Panel de plataforma — fase 1 (solo lectura).
 *
 * Lo que se prueba acá no es «devuelve datos», que es lo fácil. Es la frontera: que un `owner` de
 * finca no entre, que un admin deshabilitado deje de entrar EN LA REQUEST SIGUIENTE, que no se
 * filtren hashes ni tokens, y que el contexto de plataforma no se pegue a la conexión.
 */
describe('platform — panel de administración global', () => {
  let db: DbService;
  let pdb: PlatformDb;
  let platform: PlatformService;
  let auth: PlatformAuthService;
  let guard: PlatformAdminGuard;
  let originalCwd: string;
  let tmp: string;

  /** Tenant demo + su owner (viene del seed). */
  let demoTenant: string;
  let ownerUser: string;
  /** Segunda organización, para probar que el panel las ve a las dos. */
  let otherTenant: string;
  /** Usuario que ES administrador de plataforma. */
  let adminUser: string;

  const ctx = (req: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as never;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'platform-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    delete process.env.PLATFORM_MFA_ENFORCED;
    db = new DbService();
    await db.onModuleInit();
    pdb = new PlatformDb(db);
    platform = new PlatformService(pdb);
    auth = new PlatformAuthService(db, pdb);
    guard = new PlatformAdminGuard(pdb);

    demoTenant = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    ownerUser = (
      await db.query<{ user_id: string }>(`SELECT user_id FROM user_role_assignments WHERE tenant_id = $1 LIMIT 1`, [
        demoTenant,
      ])
    )[0].user_id;

    // Segunda organización con un usuario propio: sin ella, «ve todos los tenants» no prueba nada.
    otherTenant = (
      await db.query<{ id: string }>(
        `INSERT INTO organizations (name, legal_name, country_code, default_currency, timezone, status)
         VALUES ('Hacienda El Roble','El Roble C.A.','VE','USD','America/Caracas','suspended') RETURNING id`,
      )
    )[0].id;
    const otherUser = (
      await db.query<{ id: string }>(
        `INSERT INTO users (email, full_name, password_hash, email_verified_at)
         VALUES ('roble@example.com','Ana Roble',$1, now()) RETURNING id`,
        [await hashPassword('roble-pass')],
      )
    )[0].id;
    const ownerRole = (await db.query<{ id: string }>(`SELECT id FROM roles WHERE code='owner' AND tenant_id IS NULL`))[0].id;
    await db.query(`INSERT INTO user_role_assignments (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      otherTenant,
      otherUser,
      ownerRole,
    ]);

    // El administrador de plataforma: un usuario SIN organización. Ese es justamente el caso que
    // el login del ERP no puede atender (lanza auth.no_tenant).
    adminUser = (
      await db.query<{ id: string }>(
        `INSERT INTO users (email, full_name, password_hash) VALUES ('dueno@cowinance.com','Dueño Cowinance',$1) RETURNING id`,
        [await hashPassword('plataforma-2026')],
      )
    )[0].id;
    await pdb.read((q) =>
      q.query(`INSERT INTO platform_admins (user_id, role, mfa_required) VALUES ($1,'superadmin',true)`, [adminUser]),
    );
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Frontera de acceso ─────────────────────────────────────────────────────────────────────

  it('un owner de finca NO puede entrar: su access token ni siquiera verifica contra la clave de plataforma', async () => {
    // Token REAL del ERP, con la forma exacta que emite AuthService para un owner.
    const tokenErp = jwt.sign(
      { sub: ownerUser, ten: demoTenant, role: 'owner', name: 'Jose', email: 'cowinance@gmail.com', typ: 'access' },
      JWT_SECRET,
      { issuer: JWT_ISSUER, expiresIn: 900 },
    );
    expect(verifyPlatformToken(tokenErp)).toBeNull();
    await expect(
      guard.canActivate(ctx({ headers: { authorization: `Bearer ${tokenErp}` }, url: '/v1/platform/dashboard', method: 'GET' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('las claves del ERP y de plataforma son distintas: un token no vale en el otro mundo', async () => {
    expect(PLATFORM_JWT_SECRET).not.toBe(JWT_SECRET);
    const tokenPlatform = signPlatformToken({ sub: adminUser, prole: 'superadmin', mfa: false });
    // Y al revés: el interceptor del ERP verifica con JWT_SECRET, que acá ni siquiera valida firma.
    expect(() => jwt.verify(tokenPlatform, JWT_SECRET, { issuer: JWT_ISSUER })).toThrow();
  });

  it('un usuario común con token de plataforma bien firmado tampoco entra (no está en platform_admins)', async () => {
    const forjado = signPlatformToken({ sub: ownerUser, prole: 'superadmin', mfa: false });
    await expect(
      guard.canActivate(ctx({ headers: { authorization: `Bearer ${forjado}` }, url: '/v1/platform/users', method: 'GET' })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('sin cabecera Authorization, 401', async () => {
    await expect(guard.canActivate(ctx({ headers: {}, url: '/v1/platform/dashboard', method: 'GET' }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('un administrador de plataforma SÍ entra, y el guard resuelve su rol desde la base', async () => {
    const req: Record<string, any> = {
      headers: { authorization: `Bearer ${signPlatformToken({ sub: adminUser, prole: 'superadmin', mfa: false })}` },
      url: '/v1/platform/dashboard',
      method: 'GET',
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.platformActor).toMatchObject({ userId: adminUser, role: 'superadmin', email: 'dueno@cowinance.com' });
  });

  it('deshabilitar a un admin corta el acceso en la request siguiente, sin esperar a que venza el token', async () => {
    const token = signPlatformToken({ sub: adminUser, prole: 'superadmin', mfa: false });
    const req = () => ctx({ headers: { authorization: `Bearer ${token}` }, url: '/v1/platform/users', method: 'GET' });
    await expect(guard.canActivate(req())).resolves.toBe(true);

    await pdb.read((q) => q.query(`UPDATE platform_admins SET disabled_at = now() WHERE user_id = $1`, [adminUser]));
    await expect(guard.canActivate(req())).rejects.toMatchObject({ status: 403 });

    await pdb.read((q) => q.query(`UPDATE platform_admins SET disabled_at = NULL WHERE user_id = $1`, [adminUser]));
    await expect(guard.canActivate(req())).resolves.toBe(true);
  });

  // ── Login ──────────────────────────────────────────────────────────────────────────────────

  it('login de plataforma: emite sesión propia, sin claim de tenant', async () => {
    const res = await auth.login({ email: 'dueno@cowinance.com', password: 'plataforma-2026' });
    expect(res.admin).toMatchObject({ role: 'superadmin', email: 'dueno@cowinance.com' });
    const payload = verifyPlatformToken(res.access_token)!;
    expect(payload.typ).toBe('platform');
    expect(payload).not.toHaveProperty('ten');
    // Sin refresh token: la sesión de plataforma no se renueva sola (ver platform-session.ts).
    expect(res).not.toHaveProperty('refresh_token');
  });

  it('el login de un usuario válido que NO es admin de plataforma da el mismo error que una contraseña mal', async () => {
    const noAdmin = auth.login({ email: 'roble@example.com', password: 'roble-pass' });
    const malaClave = auth.login({ email: 'dueno@cowinance.com', password: 'incorrecta' });
    await expect(noAdmin).rejects.toMatchObject({ status: 401 });
    await expect(malaClave).rejects.toMatchObject({ status: 401 });
    // Mismo código: el endpoint no puede servir para averiguar QUIÉN administra Cowinance.
    const [a, b] = await Promise.all([noAdmin.catch((e) => e), malaClave.catch((e) => e)]);
    expect(a.response.code).toBe(b.response.code);
  });

  it('con PLATFORM_MFA_ENFORCED prendido, un admin sin segundo factor queda afuera', async () => {
    process.env.PLATFORM_MFA_ENFORCED = 'on';
    try {
      await expect(auth.login({ email: 'dueno@cowinance.com', password: 'plataforma-2026' })).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      delete process.env.PLATFORM_MFA_ENFORCED;
    }
    // Y apagado vuelve a entrar: la puerta es la variable, no el código.
    await expect(auth.login({ email: 'dueno@cowinance.com', password: 'plataforma-2026' })).resolves.toBeTruthy();
  });

  // ── Métricas del dashboard ─────────────────────────────────────────────────────────────────

  it('el dashboard cuenta las DOS organizaciones y las clasifica por estado', async () => {
    const d = await platform.dashboard();
    expect(d.organizations.total).toBeGreaterThanOrEqual(2);
    expect(d.organizations.active).toBeGreaterThanOrEqual(1);
    expect(d.organizations.suspended).toBeGreaterThanOrEqual(1);
    expect(d.organizations.total).toBe(
      d.organizations.active + d.organizations.suspended + d.organizations.churned,
    );

    expect(d.users.total).toBeGreaterThanOrEqual(3);
    expect(d.users.email_verified + d.users.email_unverified).toBe(d.users.total);
    expect(d.users.email_verified).toBeGreaterThanOrEqual(1); // roble@example.com

    // Animales del seed: el conteo global tiene que coincidir con el de la base, sin tenant.
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals WHERE status='active' AND deleted_at IS NULL`,
    );
    expect(d.herd.active_animals).toBe(n);

    expect(typeof d.storage.bytes).toBe('string'); // bigint como texto, no como number
    expect(Array.isArray(d.plans)).toBe(true);
  });

  // ── Listados y detalle ─────────────────────────────────────────────────────────────────────

  it('el listado de organizaciones ve todos los tenants y trae usuarios, animales y plan', async () => {
    const { data, total } = await platform.organizations({});
    expect(total).toBeGreaterThanOrEqual(2);
    const ids = data.map((o: any) => o.id);
    expect(ids).toContain(demoTenant);
    expect(ids).toContain(otherTenant);

    const demo: any = data.find((o: any) => o.id === demoTenant);
    expect(demo.users).toBeGreaterThanOrEqual(1);
    expect(demo.animals).toBeGreaterThan(0);
    expect(demo).toHaveProperty('country_code');
    expect(demo).toHaveProperty('default_currency');
    expect(demo).toHaveProperty('subscription_status');
  });

  it('los filtros de organizaciones acotan por estado, país y búsqueda', async () => {
    const suspendidas = await platform.organizations({ status: 'suspended' });
    expect(suspendidas.data.map((o: any) => o.id)).toEqual([otherTenant]);

    const venezolanas = await platform.organizations({ country: 've' });
    expect(venezolanas.data.map((o: any) => o.id)).toEqual([otherTenant]);

    const busqueda = await platform.organizations({ q: 'Roble' });
    expect(busqueda.data.map((o: any) => o.id)).toEqual([otherTenant]);

    const nada = await platform.organizations({ q: 'no-existe-esta-finca' });
    expect(nada.data).toEqual([]);
    expect(nada.total).toBe(0);
    // Las facetas salen del conjunto SIN filtrar: si salieran del resultado, filtrar por un país
    // dejaría ese país como única opción y el filtro se cerraría sobre sí mismo.
    expect(nada.facets.countries).toEqual(expect.arrayContaining(['VE']));
    expect(venezolanas.facets.countries.length).toBeGreaterThan(1);
  });

  it('el detalle de una organización trae usuarios, fincas, uso y actividad', async () => {
    const d: any = await platform.organization(demoTenant);
    expect(d.organization.id).toBe(demoTenant);
    expect(d.users.length).toBeGreaterThanOrEqual(1);
    expect(d.users[0]).toHaveProperty('role');
    expect(d.farms.length).toBeGreaterThanOrEqual(1);
    expect(d.usage.active_animals).toBeGreaterThan(0);
    expect(d.usage).toHaveProperty('storage_bytes');
    expect(d.activity).toHaveProperty('last_animal_at');
    expect(d.activity).toHaveProperty('last_login_at');
  });

  it('un id inexistente da 404, no una respuesta vacía', async () => {
    await expect(platform.organization('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  it('el listado de usuarios trae sus organizaciones y el rol en cada una', async () => {
    const { data } = await platform.users({ q: 'roble@example.com' });
    expect(data).toHaveLength(1);
    const u: any = data[0];
    expect(u.email_verified).toBe(true);
    expect(u.organizations).toEqual([{ tenant_id: otherTenant, name: 'Hacienda El Roble', role: 'owner' }]);
  });

  it('un usuario sin organizaciones devuelve [] y no una organización fantasma', async () => {
    const { data } = await platform.users({ q: 'dueno@cowinance.com' });
    expect((data[0] as any).organizations).toEqual([]);
    expect((data[0] as any).platform_role).toBe('superadmin');
  });

  it('los filtros de usuarios acotan por verificación de email y estado', async () => {
    const sinVerificar = await platform.users({ email_verified: 'false' });
    expect(sinVerificar.data.map((u: any) => u.email)).toContain('dueno@cowinance.com');
    expect(sinVerificar.data.map((u: any) => u.email)).not.toContain('roble@example.com');

    const verificados = await platform.users({ email_verified: 'true' });
    expect(verificados.data.map((u: any) => u.email)).toContain('roble@example.com');

    const bloqueados = await platform.users({ status: 'blocked' });
    expect(bloqueados.data).toEqual([]);
  });

  it('la paginación está acotada: un limit desmedido no baja la API', async () => {
    const r = await platform.users({ limit: '1000000' });
    expect(r.limit).toBe(200);
    const p = await platform.users({ limit: '1', offset: '1' });
    expect(p.data).toHaveLength(1);
    expect(p.offset).toBe(1);
  });

  // ── Atención: a quién llamar hoy ────────────────────────────────────────────────────────────

  /**
   * El resumen eran ocho contadores correctos y ninguno accionable. Estos tests fijan las tres
   * definiciones de «necesita algo», que son la razón de ser del bloque.
   */
  describe('bloque de atención', () => {
    let conVencimiento: string;

    beforeAll(async () => {
      // Una cuenta con el período venciendo en 3 días, en un plan con techo de 1000 animales.
      conVencimiento = (
        await db.query<{ id: string }>(
          `INSERT INTO organizations (name, country_code, default_currency, timezone)
           VALUES ('Finca Por Vencer','VE','USD','America/Caracas') RETURNING id`,
        )
      )[0].id;
      const trial = (await db.query<{ id: string }>(`SELECT id FROM plans WHERE code='trial'`))[0].id;
      await db.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, billing_currency, current_period_start, current_period_end)
         VALUES ($1,$2,'trialing','USD', CURRENT_DATE - 27, CURRENT_DATE + 3)`,
        [conVencimiento, trial],
      );
    });

    it('detecta el período que vence dentro de 7 días, con los días ya calculados', async () => {
      const d: any = await platform.dashboard();
      const fila = d.attention.expiring.find((x: any) => x.id === conVencimiento);
      expect(fila).toBeTruthy();
      expect(fila.dias_para_vencer).toBe(3);
      expect(d.attention.expiring_total).toBeGreaterThanOrEqual(1);
    });

    it('el filtro del listado devuelve LO MISMO que la tarjeta: si divergieran, la tarjeta mentiría', async () => {
      const d: any = await platform.dashboard();
      const lista = await platform.organizations({ expiring: '7' });
      expect(lista.total).toBe(d.attention.expiring_total);
      expect(lista.data.map((o: any) => o.id)).toContain(conVencimiento);
    });

    it('«sobre el límite» compara el uso real contra el techo del plan', async () => {
      // La finca demo tiene ~66 animales y el trial admite 1000: NO está sobre el límite.
      const antes = await platform.organizations({ over_limit: '1' });
      expect(antes.data.map((o: any) => o.id)).not.toContain(demoTenant);

      // Se le baja el techo del plan por debajo de su hato: ahora sí.
      await db.query(`UPDATE plans SET max_animals = 1 WHERE code = 'trial'`);
      const trial = (await db.query<{ id: string }>(`SELECT id FROM plans WHERE code='trial'`))[0].id;
      await db.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, billing_currency, current_period_start, current_period_end)
         VALUES ($1,$2,'trialing','USD', CURRENT_DATE, CURRENT_DATE + 30)`,
        [demoTenant, trial],
      );
      const despues = await platform.organizations({ over_limit: '1' });
      expect(despues.data.map((o: any) => o.id)).toContain(demoTenant);
      await db.query(`UPDATE plans SET max_animals = 1000 WHERE code = 'trial'`);
    });

    it('«sin actividad» incluye a la que NUNCA ingresó, que es a quien más conviene llamar', async () => {
      // `conVencimiento` no tiene usuarios, así que su last_login_at es NULL.
      const inactivas = await platform.organizations({ idle: '30' });
      expect(inactivas.data.map((o: any) => o.id)).toContain(conVencimiento);
      const nunca: any = inactivas.data.find((o: any) => o.id === conVencimiento);
      expect(nunca?.last_login_at).toBeNull();
    });

    it('los filtros de atención se combinan con los normales', async () => {
      const combinado = await platform.organizations({ expiring: '7', country: 'VE' });
      expect(combinado.data.every((o: any) => o.country_code === 'VE')).toBe(true);
      expect(combinado.data.map((o: any) => o.id)).toContain(conVencimiento);

      const otroPais = await platform.organizations({ expiring: '7', country: 'AR' });
      expect(otroPais.data.map((o: any) => o.id)).not.toContain(conVencimiento);
    });
  });

  // ── Campos sensibles ───────────────────────────────────────────────────────────────────────

  it('ninguna respuesta del panel expone hashes, tokens ni credenciales', async () => {
    const cuerpos = JSON.stringify([
      await platform.dashboard(),
      await platform.organizations({}),
      await platform.organization(demoTenant),
      await platform.users({}),
    ]);
    // Se busca en el JSON SERIALIZADO y no campo por campo: una consulta futura que agregue un
    // `SELECT *` sobre `users` metería `password_hash` sin que ninguna aserción por propiedad se
    // entere. Acá se entera.
    for (const prohibido of [
      'password_hash',
      'refresh_token',
      'auth_refresh_tokens',
      'email_action_token',
      'push_token',
      'jti',
      'secret',
    ]) {
      expect(cuerpos).not.toContain(prohibido);
    }
    // Y el hash real del usuario demo tampoco aparece por otro nombre.
    const [{ password_hash }] = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id=$1`, [
      ownerUser,
    ]);
    expect(cuerpos).not.toContain(password_hash);
  });

  // ── Aislamiento: que el panel no contamine el ERP ──────────────────────────────────────────

  it('el contexto de plataforma NO sobrevive a su transacción (no se pega a la conexión del pool)', async () => {
    await pdb.read((q) => q.query(`SELECT 1`));
    const [{ guc }] = await db.query<{ guc: string | null }>(
      `SELECT current_setting('app.platform_read', true) AS guc`,
    );
    // Fuera de la transacción vale NULL o '' — nunca 'on'. Los dos casos son fail-closed en la
    // policy, que compara contra el literal.
    expect(guc === null || guc === '').toBe(true);
  });

  it('PlatformDb se niega a correr dentro de una request de tenant', async () => {
    await requestContext.run({ userId: ownerUser, tenantId: demoTenant, role: 'owner' } as never, async () => {
      await expect(pdb.read((q) => q.query(`SELECT 1`))).rejects.toThrow(/request de tenant/);
    });
  });

  it('las policies del plano de plataforma existen y son las esperadas', async () => {
    const rows = await db.query<{ tablename: string; policyname: string; cmd: string }>(
      `SELECT tablename, policyname, cmd FROM pg_policies
        WHERE schemaname='public' AND policyname IN ('platform_read','platform_only')`,
    );
    const lectura = rows.filter((r) => r.policyname === 'platform_read');
    // FOR SELECT en TODAS: es lo que hace que la fase 1 sea de solo lectura por construcción.
    expect(lectura.every((r) => r.cmd === 'SELECT')).toBe(true);
    expect(lectura.map((r) => r.tablename).sort()).toEqual(
      ['animals', 'billing_payments', 'companies', 'farms', 'files', 'subscription_usage', 'subscriptions', 'sync_devices'],
    );
    // Y `tenant_isolation` sigue en pie sobre las mismas tablas: la permisiva se SUMA, no reemplaza.
    const tenant = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname='public' AND policyname='tenant_isolation' AND tablename = ANY($1)`,
      [lectura.map((r) => r.tablename)],
    );
    expect(tenant[0].n).toBe(lectura.length);

    expect(rows.filter((r) => r.policyname === 'platform_only').map((r) => r.tablename).sort()).toEqual([
      'platform_admins',
      'platform_audit_logs',
    ]);
  });

  // ── Bitácora ───────────────────────────────────────────────────────────────────────────────

  it('la bitácora global registra los accesos, incluidos los rechazados', async () => {
    await pdb.audit({
      actorUserId: adminUser,
      actorEmail: 'dueno@cowinance.com',
      actorRole: 'superadmin',
      action: 'GET /v1/platform/organizations/:id',
      targetType: 'organization',
      targetId: demoTenant,
      targetTenantId: demoTenant,
      detail: { query: { q: 'esperanza' } },
      ip: '10.0.0.1',
    });
    const { data } = await platform.auditLog({ limit: 50 });
    const entrada: any = data.find((e: any) => e.action === 'GET /v1/platform/organizations/:id');
    expect(entrada).toBeTruthy();
    expect(entrada.actor_email).toBe('dueno@cowinance.com');
    expect(entrada.target_tenant_id).toBe(demoTenant);

    // Y los intentos fallidos del login quedaron registrados como 'denied'.
    expect(data.some((e: any) => e.outcome === 'denied')).toBe(true);
  });

  /**
   * La bitácora se estaba ahogando en su propio ruido: medido sobre datos reales, 75 de 99 entradas
   * eran navegación del panel, y las que justifican que el módulo exista quedaban sepultadas. Estos
   * tests fijan la separación y los filtros que la hacen usable.
   */
  it('separa ACCIONES de ACCESOS por el nombre del evento', async () => {
    const acciones = await platform.auditLog({ kind: 'accion', limit: 200 });
    const accesos = await platform.auditLog({ kind: 'acceso', limit: 200 });

    // Los eventos de dominio llevan punto; los de navegación empiezan con el verbo HTTP. Esa es la
    // invariante de la que depende la clasificación derivada (sin columna nueva).
    expect(acciones.data.every((e: any) => !e.action.startsWith('GET '))).toBe(true);
    expect(acciones.data.every((e: any) => e.es_accion === true)).toBe(true);
    expect(accesos.data.every((e: any) => e.action.startsWith('GET '))).toBe(true);

    // El login es una ACCIÓN, no navegación: por eso se renombró a `platform.login`.
    expect(acciones.data.some((e: any) => e.action === 'platform.login')).toBe(true);

    const todo = await platform.auditLog({ limit: 200 });
    expect(acciones.total + accesos.total).toBe(todo.total);
  });

  it('filtra por actor, por organización y por acción', async () => {
    const porActor = await platform.auditLog({ actor: 'dueno@cowinance.com' });
    expect(porActor.data.length).toBeGreaterThan(0);
    expect(porActor.data.every((e: any) => e.actor_email === 'dueno@cowinance.com')).toBe(true);

    // «¿Quién tocó ESTA finca?» — la pregunta que antes había que responder leyendo todo a ojo.
    const porFinca = await platform.auditLog({ tenant: demoTenant });
    expect(porFinca.data.length).toBeGreaterThan(0);
    expect(porFinca.data.every((e: any) => e.target_tenant_id === demoTenant)).toBe(true);

    const porAccion = await platform.auditLog({ action: 'platform.login' });
    expect(porAccion.data.every((e: any) => e.action === 'platform.login')).toBe(true);

    const rechazados = await platform.auditLog({ outcome: 'denied' });
    expect(rechazados.data.every((e: any) => e.outcome === 'denied')).toBe(true);
  });

  it('el filtro «hasta» incluye el día entero, no solo su medianoche', async () => {
    // El día se le pregunta a la BASE, no a `new Date().toISOString()`, que es UTC siempre.
    //
    // La consulta interpreta `$1::date` en la zona de la SESIÓN, y las filas se sellaron con `now()`
    // en esa misma zona. Tomar el día de UTC hacía que entre la medianoche UTC y la de la finca
    // —cuatro horas por día en Venezuela— el test pidiera el día siguiente y encontrara cero filas.
    // Un test que pasa 20 horas al día y falla 4 es peor que uno que falla siempre: nadie sabe si
    // lo que rompió fue el cambio o el reloj.
    const hoy = (await db.one<{ d: string }>(`SELECT CURRENT_DATE::text AS d`))!.d;
    const delDia = await platform.auditLog({ from: hoy, to: hoy, limit: 200 });
    // Todo lo de esta suite ocurrió hoy: si `to` se aplicara con `<=` sobre el timestamp, esto
    // daría cero — el error clásico de los filtros de fecha «hasta».
    expect(delDia.total).toBeGreaterThan(0);
  });

  it('las facetas salen del conjunto SIN filtrar, para que el selector no se cierre', async () => {
    // Hace falta MÁS DE UNA acción distinta para que la aserción signifique algo: con una sola, un
    // selector que se cierra sobre el filtro y uno que no se ven idénticos.
    await pdb.audit({ actorEmail: 'dueno@cowinance.com', actorRole: 'superadmin', action: 'organization.suspend' });

    const filtrado = await platform.auditLog({ action: 'platform.login' });
    // Filtrando por UNA acción, el selector sigue ofreciendo las demás: si saliera del conjunto ya
    // filtrado, quedaría con `platform.login` como única opción y no habría forma de volver.
    expect(filtrado.facets.actions.length).toBeGreaterThan(1);
    expect(filtrado.facets.actions).toContain('platform.login');
    expect(filtrado.facets.actions).toContain('organization.suspend');
    expect(filtrado.data.every((e: any) => e.action === 'platform.login')).toBe(true);
    // Y no ofrece acciones que no existen ni entradas de navegación como si fueran acciones.
    expect(filtrado.facets.actions.every((a: string) => !a.startsWith('GET '))).toBe(true);
  });
});
