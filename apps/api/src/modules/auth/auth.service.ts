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

    /**
     * A qué organización entra.
     *
     * Antes era `LIMIT 1` sobre la asignación más vieja, con un «v0: multi-organización después»
     * al lado. Ese límite se sentía lejos de acá: por él una invitación a alguien que ya tenía
     * cuenta se rechazaba —la asignación se habría creado bien y la persona habría entrado siempre
     * a su organización vieja, sin ningún error visible— y un veterinario que atiende dos fincas no
     * podía ser dado de alta en la segunda.
     *
     * Con una sola organización, que es el caso de casi todos, no cambia nada: se entra ahí.
     * Con varias, `organization_id` elige, y si no viene se entra a la primera y la respuesta trae
     * la lista para que el cliente ofrezca cambiar. Nunca se falla pidiendo que elija: quien tiene
     * dos fincas igual quiere entrar a alguna.
     */
    const asignaciones = await this.assignmentsOf(user.id);
    if (asignaciones.length === 0)
      throw new UnauthorizedException({ code: 'auth.no_tenant', title: 'El usuario no pertenece a ninguna organización' });

    const pedida = (body as { organization_id?: string })?.organization_id?.trim();
    const elegida = pedida ? asignaciones.find((a) => a.tenant_id === pedida) : asignaciones[0];
    if (!elegida)
      throw new UnauthorizedException({
        code: 'auth.no_access_to_organization',
        title: 'No tenés acceso a esa organización',
      });

    await this.assertOrganizationActive(elegida.tenant_id);

    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    const tokens = await this.issueTokens(user, elegida.tenant_id, elegida.role);
    return { ...tokens, organizations: asignaciones };
  }

  /**
   * Organizaciones del usuario de la sesión, con su rol en cada una.
   *
   * La necesita el selector: sin esto, quien pertenece a dos fincas no tiene forma de saber que la
   * otra existe.
   */
  async organizations() {
    const ctx = requestContext.getStore()!;
    return this.assignmentsOf(ctx.userId);
  }

  /**
   * Cambia de organización sin volver a pedir la contraseña.
   *
   * Emite un par de tokens nuevo para la otra finca. NO revoca el de la actual: alguien puede
   * querer las dos abiertas en dos pestañas, y cerrarle una al abrir la otra sería una sorpresa
   * desagradable en el medio de una carga.
   */
  async switchOrganization(body: { organization_id?: string }) {
    const ctx = requestContext.getStore()!;
    const destino = (body?.organization_id ?? '').trim();
    if (!destino)
      throw new UnauthorizedException({ code: 'auth.missing_organization', title: 'organization_id es obligatorio' });

    const assignment = await this.assignmentOf(ctx.userId, destino);
    if (!assignment)
      throw new UnauthorizedException({
        code: 'auth.no_access_to_organization',
        title: 'No tenés acceso a esa organización',
      });
    await this.assertOrganizationActive(destino);

    const user = await this.db.one<any>(`SELECT id, email, full_name FROM users WHERE id = $1`, [ctx.userId]);
    return this.issueTokens(user, destino, assignment.role);
  }

  /** Asignaciones VIGENTES del usuario, con el nombre de cada organización. Las más viejas primero. */
  private async assignmentsOf(userId: string) {
    return this.db.query<{ tenant_id: string; name: string; role: string }>(
      `SELECT ura.tenant_id, o.name, r.code AS role
       FROM user_role_assignments ura
       JOIN roles r ON r.id = ura.role_id
       JOIN organizations o ON o.id = ura.tenant_id
       WHERE ura.user_id = $1 AND ura.deleted_at IS NULL
         AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)
       ORDER BY ura.created_at`,
      [userId],
    );
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

    /**
     * El rol se relee de la BASE, no del token.
     *
     * Antes salía de `payload.role ?? 'owner'`, y eso tenía dos agujeros que no se notaban mientras
     * el rol no restringía nada:
     *
     *  1. **Quitarle el acceso a alguien no se lo quitaba.** El login le daba 401, pero su refresh
     *     seguía funcionando SIETE DÍAS y le devolvía un token con el rol viejo, que la API aceptaba
     *     sin chistar. Comprobado antes de este cambio: revocado, `/animals` seguía dando 200.
     *  2. **Bajarle el rol a alguien tampoco.** De administrador a operario seguía siendo
     *     administrador hasta que venciera el refresh.
     *
     * Y el `?? 'owner'` convertía un token sin `role` en dueño de la finca: nunca pasó porque
     * `issueTokens` siempre lo firma, pero es el default más caro posible para una equivocación.
     *
     * Releerlo hace que revocaciones, cambios de rol y vencimientos de `valid_until` surtan efecto
     * en cuanto vence el access token, sin tocar el resto del sistema.
     */
    const assignment = await this.assignmentOf(row.user_id, row.tenant_id);
    if (!assignment)
      throw new UnauthorizedException({
        code: 'auth.access_revoked',
        title: 'Ya no tenés acceso a esta organización',
      });

    return this.issueTokens(user, row.tenant_id, assignment.role);
  }

  /** La asignación VIGENTE de un usuario en una organización, o `null` si no tiene. */
  private async assignmentOf(userId: string, tenantId: string): Promise<{ role: string } | null> {
    const row = await this.db.one<{ role: string }>(
      `SELECT r.code AS role
       FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
       WHERE ura.user_id = $1 AND ura.tenant_id = $2 AND ura.deleted_at IS NULL
         AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)
       ORDER BY ura.created_at LIMIT 1`,
      [userId, tenantId],
    );
    return row ?? null;
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
      /**
       * MODO ESPEJO. La web lo usa para dibujar la franja de advertencia.
       *
       * **Que esto viaje NO es opcional.** Sin la franja, alguien de soporte con dos pestañas
       * abiertas no tiene forma de saber en cuál está mirando la finca de un cliente. Ese es el
       * error que precede a «le conté al cliente algo de otro cliente».
       *
       * Va el email de quien está adentro, no el del cliente: la pregunta que la franja responde es
       * «¿quién soy YO ahora mismo?».
       */
      // `sid` viaja para que el botón de salir pueda cerrar la sesión en la bitácora. No es una
      // credencial —no sirve para entrar a ningún lado—, solo el hilo que ata inicio y cierre.
      impersonation: ctx.impersonatedBy
        ? {
            by_email: ctx.impersonatedBy.by_email,
            by_role: ctx.impersonatedBy.by_role,
            sid: ctx.impersonatedBy.sid,
            read_only: true,
          }
        : null,
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
