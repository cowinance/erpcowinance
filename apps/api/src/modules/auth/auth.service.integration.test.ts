import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { AuthService, JWT_ISSUER, JWT_SECRET } from './auth.service';

/**
 * El módulo más sensible del sistema no tenía un solo test propio.
 *
 * La auditoría del 11-11 lo marcó como el hallazgo más incómodo: `AuthService` decide quién entra,
 * con qué rol y por cuánto tiempo, y estaba cubierto solo de refilón por tests de otros módulos.
 * Entre lo que no tenía test estaba un arreglo de seguridad de agosto —el refresh revalida la
 * asignación contra la base— verificado a mano y nunca fijado.
 *
 * Lo que se prueba acá es, sobre todo, lo que NO tiene que pasar: que un acceso revocado siga
 * sirviendo, que un rol viejo siga valiendo, que un refresh robado se pueda usar dos veces, o que
 * un error de login cuente si el email existe.
 */
describe('AuthService', () => {
  let db: DbService;
  let auth: AuthService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let otroTenantId: string;
  let ownerId: string;

  const EMAIL = 'cowinance@gmail.com';
  const CLAVE = 'cowinance';

  /** El código del rechazo es el contrato; el título está para que lo lea una persona. */
  const rechaza = async (codigo: string, fn: () => Promise<unknown>) => {
    await expect(fn()).rejects.toMatchObject({ response: { code: codigo } });
  };

  const comoOwner = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ userId: ownerId, tenantId, role: 'owner' }, fn);

  const claims = (token: string) => jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as Record<string, unknown>;

  /** Entra y devuelve el par de tokens. */
  const entrar = () => auth.login({ email: EMAIL, password: CLAVE });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'auth-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    auth = new AuthService(db);
    tenantId = db.tenant;
    ownerId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [EMAIL]))[0].id;
    otroTenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations WHERE id <> $1 LIMIT 1`, [tenantId]))[0]
      .id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Cada test parte del estado del seed. Varios de abajo suspenden la organización, revocan la
   * asignación o cambian el rol: sin esto el resultado dependería del orden en que corren, que es
   * la peor clase de test intermitente porque falla el que no tiene la culpa.
   */
  beforeEach(async () => {
    await db.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [tenantId]);
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerId]);
    await db.query(
      `UPDATE user_role_assignments SET deleted_at = NULL, valid_until = NULL,
              role_id = (SELECT id FROM roles WHERE code = 'owner')
        WHERE user_id = $1 AND tenant_id = $2`,
      [ownerId, tenantId],
    );
    await db.query(`DELETE FROM user_role_assignments WHERE user_id = $1 AND tenant_id = $2`, [ownerId, otroTenantId]);
    await db.query(`DELETE FROM auth_refresh_tokens WHERE user_id = $1`, [ownerId]);
  });

  describe('login', () => {
    it('devuelve el par de tokens y las organizaciones de la persona', async () => {
      const r = await entrar();
      expect(r.token_type).toBe('Bearer');
      expect(r.user).toMatchObject({ email: EMAIL, role: 'owner', tenant_id: tenantId });
      expect(r.organizations.map((o) => o.tenant_id)).toContain(tenantId);
      expect(claims(r.access_token)).toMatchObject({ sub: ownerId, ten: tenantId, role: 'owner', typ: 'access' });
    });

    it('acepta el email con mayúsculas y espacios: nadie escribe su correo igual dos veces', async () => {
      await expect(auth.login({ email: `  ${EMAIL.toUpperCase()} `, password: CLAVE })).resolves.toMatchObject({
        user: { email: EMAIL },
      });
    });

    it('sin credenciales lo dice, en vez de tratarlo como contraseña equivocada', async () => {
      await rechaza('auth.missing_credentials', () => auth.login({}));
      await rechaza('auth.missing_credentials', () => auth.login({ email: EMAIL }));
      await rechaza('auth.missing_credentials', () => auth.login({ password: CLAVE }));
    });

    /**
     * El MISMO código para los tres casos, a propósito: distinguirlos le diría a quien prueba
     * correos al azar cuáles están registrados en el sistema.
     */
    it('no deja saber si el email existe', async () => {
      await rechaza('auth.invalid_credentials', () => auth.login({ email: EMAIL, password: 'no-es' }));
      await rechaza('auth.invalid_credentials', () => auth.login({ email: 'nadie@ejemplo.test', password: CLAVE }));
      await db.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [ownerId]);
      await rechaza('auth.invalid_credentials', () => auth.login({ email: EMAIL, password: CLAVE }));
    });

    it('con varias organizaciones entra a la pedida y las lista todas', async () => {
      await db.query(
        `INSERT INTO user_role_assignments (user_id, tenant_id, role_id)
         VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'veterinarian'))`,
        [ownerId, otroTenantId],
      );
      const r = await auth.login({ email: EMAIL, password: CLAVE, organization_id: otroTenantId } as never);
      expect(r.user.tenant_id).toBe(otroTenantId);
      expect(r.user.role).toBe('veterinarian');
      expect(r.organizations).toHaveLength(2);
    });

    /** Quien tiene dos fincas igual quiere entrar a alguna: nunca se falla pidiendo que elija. */
    it('sin elegir organización entra a la primera, sin fallar', async () => {
      await db.query(
        `INSERT INTO user_role_assignments (user_id, tenant_id, role_id)
         VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'veterinarian'))`,
        [ownerId, otroTenantId],
      );
      await expect(entrar()).resolves.toMatchObject({ user: { tenant_id: tenantId } });
    });

    it('pedir una organización ajena se rechaza, no se cae a otra', async () => {
      await rechaza('auth.no_access_to_organization', () =>
        auth.login({ email: EMAIL, password: CLAVE, organization_id: otroTenantId } as never),
      );
    });

    it('una organización suspendida no deja entrar', async () => {
      await db.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [tenantId]);
      await rechaza('auth.organization_suspended', entrar);
    });
  });

  /**
   * El refresh es donde se decide si una revocación surte efecto o tarda siete días en notarse.
   */
  describe('refresh', () => {
    it('renueva y devuelve un par nuevo', async () => {
      const { refresh_token } = await entrar();
      const r = await auth.refresh({ refresh_token });
      expect(r.access_token).toBeTruthy();
      expect(r.refresh_token).not.toBe(refresh_token);
    });

    it('cada refresh se usa UNA vez', async () => {
      const { refresh_token } = await entrar();
      await auth.refresh({ refresh_token });
      await rechaza('auth.refresh_reused', () => auth.refresh({ refresh_token }));
    });

    /**
     * Reusar un refresh es la señal de que alguien tiene una copia. No alcanza con rechazar ese:
     * hay que cortar la sesión entera, incluido el token que el ladrón (o la víctima) ya rotó.
     */
    it('el reuso revoca TODA la sesión, no solo el token repetido', async () => {
      const primero = await entrar();
      const segundo = await auth.refresh({ refresh_token: primero.refresh_token });
      await rechaza('auth.refresh_reused', () => auth.refresh({ refresh_token: primero.refresh_token }));
      // El que era válido hasta recién tampoco sirve ya.
      await rechaza('auth.refresh_revoked', () => auth.refresh({ refresh_token: segundo.refresh_token }));
    });

    it('un access token no sirve como refresh', async () => {
      const { access_token } = await entrar();
      await rechaza('auth.invalid_refresh', () => auth.refresh({ refresh_token: access_token }));
    });

    it('un token inventado o firmado con otra clave se rechaza', async () => {
      await rechaza('auth.missing_refresh', () => auth.refresh({}));
      await rechaza('auth.invalid_refresh', () => auth.refresh({ refresh_token: 'no-es-un-token' }));
      const ajeno = jwt.sign({ sub: ownerId, jti: 'x', typ: 'refresh' }, 'otra-clave', { issuer: JWT_ISSUER });
      await rechaza('auth.invalid_refresh', () => auth.refresh({ refresh_token: ajeno }));
    });

    /**
     * El arreglo de agosto, que hasta hoy nadie fijaba.
     *
     * Antes el rol salía del token (`payload.role ?? 'owner'`). Quitarle el acceso a alguien no se
     * lo quitaba: el login le daba 401 pero su refresh seguía funcionando SIETE DÍAS y devolvía un
     * token con el rol viejo, que la API aceptaba sin chistar.
     */
    it('el acceso revocado corta el refresh, no espera a que venza', async () => {
      const { refresh_token } = await entrar();
      await db.query(`UPDATE user_role_assignments SET deleted_at = now() WHERE user_id = $1 AND tenant_id = $2`, [
        ownerId,
        tenantId,
      ]);
      await rechaza('auth.access_revoked', () => auth.refresh({ refresh_token }));
    });

    it('una asignación vencida (valid_until) corta el refresh', async () => {
      const { refresh_token } = await entrar();
      await db.query(
        `UPDATE user_role_assignments SET valid_until = CURRENT_DATE - 1 WHERE user_id = $1 AND tenant_id = $2`,
        [ownerId, tenantId],
      );
      await rechaza('auth.access_revoked', () => auth.refresh({ refresh_token }));
    });

    /** Bajar de administrador a operario tiene que valer en cuanto vence el access, no en 7 días. */
    it('el rol se relee de la base: un rol rebajado no sobrevive en el token', async () => {
      const { refresh_token, access_token } = await entrar();
      expect(claims(access_token).role).toBe('owner');
      await db.query(
        `UPDATE user_role_assignments SET role_id = (SELECT id FROM roles WHERE code = 'worker')
          WHERE user_id = $1 AND tenant_id = $2`,
        [ownerId, tenantId],
      );
      const r = await auth.refresh({ refresh_token });
      expect(r.user.role).toBe('worker');
      expect(claims(r.access_token).role).toBe('worker');
    });

    it('una organización suspendida corta el refresh, no solo el login', async () => {
      const { refresh_token } = await entrar();
      await db.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [tenantId]);
      await rechaza('auth.organization_suspended', () => auth.refresh({ refresh_token }));
    });

    it('un usuario desactivado no renueva', async () => {
      const { refresh_token } = await entrar();
      await db.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [ownerId]);
      await rechaza('auth.user_inactive', () => auth.refresh({ refresh_token }));
    });
  });

  describe('logout y revocación', () => {
    it('cerrar sesión invalida ese refresh', async () => {
      const { refresh_token } = await entrar();
      await expect(auth.logout({ refresh_token })).resolves.toEqual({ ok: true });
      await rechaza('auth.refresh_revoked', () => auth.refresh({ refresh_token }));
    });

    /** Cerrar sesión no puede fallar: si el token ya no sirve, el objetivo ya está cumplido. */
    it('cerrar sesión con un token roto, o sin token, no explota', async () => {
      await expect(auth.logout({})).resolves.toEqual({ ok: true });
      await expect(auth.logout({ refresh_token: 'basura' })).resolves.toEqual({ ok: true });
    });

    it('revokeAllSessions corta todas las sesiones vivas, no la última', async () => {
      const a = await entrar();
      const b = await entrar();
      await auth.revokeAllSessions(ownerId);
      await rechaza('auth.refresh_revoked', () => auth.refresh({ refresh_token: a.refresh_token }));
      await rechaza('auth.refresh_revoked', () => auth.refresh({ refresh_token: b.refresh_token }));
    });
  });

  describe('switchOrganization', () => {
    it('cambiar a una organización sin acceso se rechaza', async () => {
      await rechaza('auth.no_access_to_organization', () =>
        comoOwner(() => auth.switchOrganization({ organization_id: otroTenantId })),
      );
    });

    it('sin organization_id lo dice', async () => {
      await rechaza('auth.missing_organization', () => comoOwner(() => auth.switchOrganization({})));
    });

    it('emite tokens de la otra finca con el rol que se tiene ALLÁ', async () => {
      await db.query(
        `INSERT INTO user_role_assignments (user_id, tenant_id, role_id)
         VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'veterinarian'))`,
        [ownerId, otroTenantId],
      );
      const r = await comoOwner(() => auth.switchOrganization({ organization_id: otroTenantId }));
      expect(claims(r.access_token)).toMatchObject({ ten: otroTenantId, role: 'veterinarian' });
    });

    /** Alguien puede querer las dos fincas abiertas en dos pestañas. */
    it('no cierra la sesión de la finca en la que estaba', async () => {
      await db.query(
        `INSERT INTO user_role_assignments (user_id, tenant_id, role_id)
         VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'veterinarian'))`,
        [ownerId, otroTenantId],
      );
      const original = await entrar();
      await comoOwner(() => auth.switchOrganization({ organization_id: otroTenantId }));
      await expect(auth.refresh({ refresh_token: original.refresh_token })).resolves.toMatchObject({
        user: { tenant_id: tenantId },
      });
    });

    it('una organización suspendida no se puede elegir desde el selector', async () => {
      await db.query(
        `INSERT INTO user_role_assignments (user_id, tenant_id, role_id)
         VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'veterinarian'))`,
        [ownerId, otroTenantId],
      );
      await db.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [otroTenantId]);
      await rechaza('auth.organization_suspended', () =>
        comoOwner(() => auth.switchOrganization({ organization_id: otroTenantId })),
      );
      await db.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [otroTenantId]);
    });
  });
});
