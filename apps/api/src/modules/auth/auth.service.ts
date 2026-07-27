import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DbService, type Q } from '../../db/db.service';
import { hashPassword, needsRehash, verifyPassword } from '../../common/passwords';
import { requestContext } from '../../common/request-context';
import { resolveJwtSecret } from './jwt-secret';

/**
 * Emisor de tokens para desarrollo con el mismo shape que un IdP OIDC
 * (claims sub/ten/role, access corto + refresh con rotación y detección de
 * reuso — doc Arquitectura §9.1). En producción este emisor se reemplaza por
 * Keycloak/Auth0: el interceptor solo cambia de clave de verificación.
 */

export const JWT_SECRET = resolveJwtSecret();
export const JWT_ISSUER = 'cowinance-dev';
const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 7 * 24 * 3600;

export interface AccessPayload {
  sub: string;
  ten: string;
  role: string;
  name: string;
  email: string;
  typ: 'access';
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async login(body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password)
      throw new UnauthorizedException({ code: 'auth.missing_credentials', title: 'email y password son obligatorios' });

    const user = await this.db.one<any>(
      `SELECT id, email, full_name, password_hash, status FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [body.email.trim().toLowerCase()],
    );
    if (!user || user.status !== 'active' || !(await verifyPassword(body.password, user.password_hash)))
      throw new UnauthorizedException({ code: 'auth.invalid_credentials', title: 'Credenciales inválidas' });

    // Re-hash transparente: el login es el ÚNICO momento con la contraseña en claro disponible,
    // así que es acá donde un hash con parámetros viejos se sube al esquema actual. Sin esto, un
    // usuario creado antes del cambio se quedaría para siempre con el costo débil.
    if (needsRehash(user.password_hash))
      await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
        user.id,
        await hashPassword(body.password),
      ]);

    // Tenant y rol del actor (v0: primera asignación; multi-organización después)
    const assignment = await this.db.one<any>(
      `SELECT ura.tenant_id, r.code AS role
       FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
       WHERE ura.user_id = $1 AND ura.deleted_at IS NULL
         AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)
       ORDER BY ura.created_at LIMIT 1`,
      [user.id],
    );
    if (!assignment)
      throw new UnauthorizedException({ code: 'auth.no_tenant', title: 'El usuario no pertenece a ninguna organización' });

    await this.assertOrganizationActive(assignment.tenant_id);

    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return this.issueTokens(user, assignment.tenant_id, assignment.role);
  }

  /** Rotación de refresh: cada token se usa UNA vez; el reuso revoca la sesión. */
  async refresh(body: { refresh_token?: string }) {
    if (!body?.refresh_token)
      throw new UnauthorizedException({ code: 'auth.missing_refresh', title: 'refresh_token es obligatorio' });
    let payload: any;
    try {
      payload = jwt.verify(body.refresh_token, JWT_SECRET, { issuer: JWT_ISSUER });
    } catch {
      throw new UnauthorizedException({ code: 'auth.invalid_refresh', title: 'Refresh token inválido o vencido' });
    }
    if (payload.typ !== 'refresh')
      throw new UnauthorizedException({ code: 'auth.invalid_refresh', title: 'No es un refresh token' });

    const row = await this.db.one<any>(`SELECT * FROM auth_refresh_tokens WHERE jti = $1`, [payload.jti]);
    if (!row || row.revoked_at) throw new UnauthorizedException({ code: 'auth.refresh_revoked', title: 'Sesión revocada' });
    if (row.rotated_at) {
      // Reuso detectado → posible robo: se revoca toda la sesión del usuario
      await this.db.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
        row.user_id,
      ]);
      throw new UnauthorizedException({ code: 'auth.refresh_reused', title: 'Refresh reutilizado: sesión revocada' });
    }
    await this.db.query(`UPDATE auth_refresh_tokens SET rotated_at = now() WHERE jti = $1`, [payload.jti]);

    const user = await this.db.one<any>(`SELECT id, email, full_name, status FROM users WHERE id = $1`, [row.user_id]);
    if (!user || user.status !== 'active')
      throw new UnauthorizedException({ code: 'auth.user_inactive', title: 'Usuario inactivo' });
    // También en el refresh, no solo en el login: sin esto, una cuenta suspendida seguiría
    // renovando su sesión indefinidamente y la suspensión solo alcanzaría a quien volviera a
    // ingresar desde cero.
    await this.assertOrganizationActive(row.tenant_id);
    return this.issueTokens(user, row.tenant_id, payload.role ?? 'owner');
  }

  /**
   * Una organización suspendida o dada de baja no puede operar.
   *
   * **POR QUÉ ESTÁ ACÁ Y NO EN CADA REQUEST.** El panel de plataforma (fase 2) permite suspender una
   * cuenta —por falta de pago, típicamente—, y hasta ahora `organizations.status` era una columna
   * que NADIE leía: suspender habría sido puramente cosmético, con el tenant trabajando igual. El
   * botón habría mentido.
   *
   * El control va en el login y en el refresh, y no en el interceptor, porque en el interceptor
   * sería una consulta más en TODAS las requests de TODAS las fincas para un dato que cambia una
   * vez cada mucho. Cachearlo sería peor: la suspensión no tendría un momento definido en que
   * empieza a valer.
   *
   * **La ventana que esto deja está acotada a propósito.** Suspender revoca además los refresh
   * tokens vivos del tenant, así que lo único que sobrevive es un access token ya emitido: 15
   * minutos como máximo. Es exactamente la misma garantía que el sistema ya daba al bloquear a un
   * usuario, y hacerla distinta acá sería inventar una segunda regla para el mismo problema.
   */
  private async assertOrganizationActive(tenantId: string): Promise<void> {
    const org = await this.db.one<{ status: string }>(`SELECT status FROM organizations WHERE id = $1`, [tenantId]);
    if (!org || org.status === 'active') return;
    throw new UnauthorizedException({
      code: 'auth.organization_suspended',
      title:
        org.status === 'suspended'
          ? 'La cuenta de tu finca está suspendida. Escribinos para reactivarla.'
          : 'La cuenta de tu finca fue dada de baja.',
    });
  }

  /**
   * Revoca las sesiones DENTRO de una transacción ajena.
   *
   * Mismo patrón que `createEntryInTx` / `recordMovementInTx`: quien suspende una cuenta necesita
   * que el cambio de estado y el corte de sesiones sean UNA sola operación. Si fueran dos
   * transacciones, una falla a mitad de camino deja la cuenta suspendida con las sesiones vivas —o
   * al revés— y nadie se entera.
   *
   * Vive en `auth` porque `auth_refresh_tokens` es suyo: el panel de plataforma no tiene por qué
   * saber cómo se almacenan las sesiones, solo pedir que se corten.
   */
  static async revokeTenantSessionsInTx(q: Q, tenantId: string): Promise<number> {
    const filas = await q.query<{ id: string }>(
      `UPDATE auth_refresh_tokens SET revoked_at = now()
        WHERE tenant_id = $1 AND revoked_at IS NULL RETURNING jti AS id`,
      [tenantId],
    );
    return filas.length;
  }

  /** Ídem para UN usuario (bloqueo individual). */
  static async revokeUserSessionsInTx(q: Q, userId: string): Promise<number> {
    const filas = await q.query<{ id: string }>(
      `UPDATE auth_refresh_tokens SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL RETURNING jti AS id`,
      [userId],
    );
    return filas.length;
  }

  /**
   * Revoca TODAS las sesiones (refresh tokens) vivas de un usuario. Lo invoca
   * `identity` al resetear la contraseña (ADR-0011, decisión F): un cambio de
   * credencial debe invalidar las sesiones existentes. `auth` es dueño de las
   * sesiones; expone esta operación para no filtrar su almacenamiento a identity.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  async logout(body: { refresh_token?: string }) {
    if (body?.refresh_token) {
      try {
        const payload: any = jwt.verify(body.refresh_token, JWT_SECRET, { issuer: JWT_ISSUER });
        await this.db.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE jti = $1`, [payload.jti]);
      } catch {
        /* token ya inválido: nada que revocar */
      }
    }
    return { ok: true };
  }

  async me() {
    const ctx = requestContext.getStore()!;
    // `timezone` viaja acá porque la web necesita saber en qué zona empieza el día de la finca:
    // los selectores de fecha y los «hoy» del cliente se calculaban en UTC y después de las 20:00
    // proponían el día siguiente.
    const org = await this.db.one<any>(`SELECT id, name, timezone FROM organizations WHERE id = $1`, [ctx.tenantId]);
    // Estado de verificación de email (P1.2/P1.3): informativo, no bloquea el
    // acceso (ADR-0011 C). La UI lo usa para el banner "verificá tu email".
    const user = await this.db.one<{ email_verified_at: string | null }>(
      `SELECT email_verified_at FROM users WHERE id = $1`,
      [ctx.userId],
    );
    return {
      user_id: ctx.userId,
      name: ctx.name,
      email: ctx.email,
      role: ctx.role,
      email_verified: !!user?.email_verified_at,
      // ¿Este servidor puede ENVIAR correo? Con el adaptador `log` el mensaje se imprime y nunca
      // sale, así que el usuario espera para siempre un enlace que no existe y los botones de
      // «reenviar» parecen rotos cuando en realidad hicieron su trabajo.
      //
      // No es información sensible —es configuración del servidor, no de una cuenta— y sin ella el
      // producto no tiene forma de explicar el único síntoma que el usuario ve: «no me llega nada».
      email_delivery: (process.env.EMAIL_PROVIDER?.trim().toLowerCase() || 'log') === 'log' ? 'log' : 'enabled',
      organization: org,
    };
  }

  private async issueTokens(user: { id: string; email: string; full_name: string }, tenantId: string, role: string) {
    const accessPayload: AccessPayload = {
      sub: user.id,
      ten: tenantId,
      role,
      name: user.full_name,
      email: user.email,
      typ: 'access',
    };
    const access = jwt.sign(accessPayload, JWT_SECRET, { issuer: JWT_ISSUER, expiresIn: ACCESS_TTL_S });

    const jti = randomUUID();
    const refresh = jwt.sign({ sub: user.id, ten: tenantId, role, jti, typ: 'refresh' }, JWT_SECRET, {
      issuer: JWT_ISSUER,
      expiresIn: REFRESH_TTL_S,
    });
    await this.db.query(
      `INSERT INTO auth_refresh_tokens (jti, user_id, tenant_id, expires_at) VALUES ($1,$2,$3,$4)`,
      [jti, user.id, tenantId, new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString()],
    );

    return {
      token_type: 'Bearer',
      access_token: access,
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      user: { id: user.id, name: user.full_name, email: user.email, role, tenant_id: tenantId },
    };
  }
}
