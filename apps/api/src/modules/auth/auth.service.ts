import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../../db/db.service';
import { verifyPassword } from '../../common/passwords';
import { requestContext } from '../../common/request-context';

/**
 * Emisor de tokens para desarrollo con el mismo shape que un IdP OIDC
 * (claims sub/ten/role, access corto + refresh con rotación y detección de
 * reuso — doc Arquitectura §9.1). En producción este emisor se reemplaza por
 * Keycloak/Auth0: el interceptor solo cambia de clave de verificación.
 */

export const JWT_SECRET = process.env.JWT_SECRET ?? 'cowinance-dev-secret';
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
    if (!user || user.status !== 'active' || !verifyPassword(body.password, user.password_hash))
      throw new UnauthorizedException({ code: 'auth.invalid_credentials', title: 'Credenciales inválidas' });

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
    return this.issueTokens(user, row.tenant_id, payload.role ?? 'owner');
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
    const org = await this.db.one<any>(`SELECT id, name FROM organizations WHERE id = $1`, [ctx.tenantId]);
    return { user_id: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role, organization: org };
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
