import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { hashPassword } from '../../common/passwords';
import { countryDefaults, isSupportedCountry } from './country-defaults';
import { EmailActionTokenService } from './email-action-token.service';
import { EMAIL_SENDER, type EmailSender } from '../../application/ports/email-sender.port';
import { AuthService } from '../auth/auth.service';

/** Base URL del front para armar los links de email (dev: localhost del web). */
function appBaseUrl(): string {
  return (process.env.APP_BASE_URL?.trim().replace(/\/$/, '')) || 'http://localhost:3000';
}

/**
 * Provisioning self-service de tenant (P1.1, ADR-0010).
 *
 * `register()` crea, en una sola transacción atómica, la identidad y el tenant
 * de una finca nueva: user → organization → company → farm → asignación de rol
 * `owner`. No emite tokens (flujo desacojado: el cliente llama luego a
 * `/auth/login`), para no invertir la dependencia identity → auth.
 *
 * RLS: el registro corre `@Public`, sin contexto de tenant. Los inserts sin
 * tenant (users, organizations) no tienen RLS; tras crear la organización se
 * fija `app.tenant_id` con SET LOCAL (is_local=true, dentro de la misma tx)
 * para que los inserts con RLS forzada (companies, farms) pasen el WITH CHECK.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(
    private readonly db: DbService,
    private readonly tokens: EmailActionTokenService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly auth: AuthService,
  ) {}

  async register(body: {
    email?: string;
    password?: string;
    full_name?: string;
    organization_name?: string;
    farm_name?: string;
    country_code?: string;
  }) {
    const email = (body?.email ?? '').trim().toLowerCase();
    const password = body?.password ?? '';
    const fullName = (body?.full_name ?? '').trim();
    const organizationName = (body?.organization_name ?? '').trim();
    const farmName = (body?.farm_name ?? '').trim();
    const countryCode = (body?.country_code ?? '').trim().toUpperCase();

    // ── Validación de entrada ─────────────────────────────────────────────
    if (!email || !password || !fullName || !organizationName || !farmName || !countryCode)
      throw new BadRequestException({
        code: 'identity.missing_fields',
        title: 'email, password, full_name, organization_name, farm_name y country_code son obligatorios',
      });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException({ code: 'identity.invalid_email', title: 'El email no tiene un formato válido' });
    if (password.length < 8)
      throw new BadRequestException({ code: 'identity.weak_password', title: 'La contraseña debe tener al menos 8 caracteres' });
    if (!isSupportedCountry(countryCode))
      throw new BadRequestException({
        code: 'identity.unsupported_country',
        title: `País no soportado: ${countryCode}. Países disponibles: AR, UY, MX, CO, US, BR`,
      });

    const defaults = countryDefaults(countryCode);

    // ── Creación atómica de identidad + tenant ────────────────────────────
    const result = await this.db.tx(async (q) => {
      // Email único: verificación explícita para un error de negocio claro
      // (la constraint UNIQUE de la tabla es la red de seguridad final).
      const existing = await q.one<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email],
      );
      if (existing)
        throw new ConflictException({ code: 'identity.email_taken', title: 'Ya existe una cuenta con ese email' });

      const owner = await q.one<{ id: string }>(`SELECT id FROM roles WHERE code = 'owner' AND tenant_id IS NULL`);
      if (!owner)
        throw new BadRequestException({
          code: 'identity.catalogs_missing',
          title: 'Los catálogos base no están inicializados',
        });

      // Plano de identidad (sin tenant, sin RLS)
      const user = (await q.one<{ id: string }>(
        `INSERT INTO users (email, full_name, locale, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
        [email, fullName, defaults.locale, hashPassword(password)],
      ))!;
      const org = (await q.one<{ id: string }>(
        `INSERT INTO organizations (name, legal_name, country_code, default_currency, default_locale, timezone, created_by)
         VALUES ($1,$1,$2,$3,$4,$5,$6) RETURNING id`,
        [organizationName, countryCode, defaults.currency, defaults.locale, defaults.timezone, user.id],
      ))!;

      // A partir de acá los inserts con RLS forzada necesitan el contexto de tenant.
      await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [org.id]);
      await q.query(`INSERT INTO user_role_assignments (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [
        org.id,
        user.id,
        owner.id,
      ]);
      const company = (await q.one<{ id: string }>(
        `INSERT INTO companies (tenant_id, name, country_code, functional_currency, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org.id, organizationName, countryCode, defaults.currency, user.id],
      ))!;
      const farm = (await q.one<{ id: string }>(
        `INSERT INTO farms (tenant_id, company_id, name, timezone, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org.id, company.id, farmName, defaults.timezone, user.id],
      ))!;

      return { userId: user.id, organizationId: org.id, companyId: company.id, farmId: farm.id };
    });

    this.logger.log(`Registro self-service: org=${result.organizationId} finca=${result.farmId} (${email})`);

    // Envío de verificación best-effort (P1.2): el token se emite y el email se
    // envía DESPUÉS del commit del registro. Si falla, el registro ya quedó
    // firme — el usuario recupera con `resend-verification`. Nunca aborta el alta.
    try {
      await this.sendVerificationEmail(result.userId, email);
    } catch (err) {
      this.logger.warn(`No se pudo enviar la verificación a ${email}: ${String(err)}`);
    }

    return {
      organization_id: result.organizationId,
      farm_id: result.farmId,
      user_id: result.userId,
      email,
    };
  }

  /**
   * Verificación de email (P1.2, @Public): consume el token de verificación y
   * marca `email_verified_at`. No bloquea el acceso (ADR-0010 §5: política soft);
   * el estado queda disponible para gating de acciones sensibles futuras.
   */
  async verifyEmail(body: { token?: string }) {
    const token = (body?.token ?? '').trim();
    if (!token)
      throw new BadRequestException({ code: 'identity.missing_token', title: 'token es obligatorio' });
    const userId = await this.tokens.consume(token, 'verify_email');
    if (!userId)
      throw new BadRequestException({ code: 'identity.invalid_token', title: 'Token de verificación inválido o expirado' });
    await this.db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`, [userId]);
    return { verified: true };
  }

  /**
   * Reenvío de verificación (P1.2, @Public). Respuesta CONSTANTE
   * (anti-enumeración): no revela si el email existe ni si ya está verificado.
   * Solo emite un token nuevo si el usuario existe y aún no verificó.
   */
  async resendVerification(body: { email?: string }) {
    const email = (body?.email ?? '').trim().toLowerCase();
    if (email) {
      const user = await this.db.one<{ id: string; email_verified_at: string | null }>(
        `SELECT id, email_verified_at FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email],
      );
      if (user && !user.email_verified_at) {
        try {
          await this.sendVerificationEmail(user.id, email);
        } catch (err) {
          this.logger.warn(`No se pudo reenviar la verificación a ${email}: ${String(err)}`);
        }
      }
    }
    return { ok: true };
  }

  /** Emite un token de verificación y envía el email con el link. */
  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.tokens.issue(userId, 'verify_email');
    const link = `${appBaseUrl()}/verify-email?token=${token}`;
    await this.email.send({
      to: email,
      subject: 'Verificá tu email — Cowinance',
      text: `Confirmá tu cuenta de Cowinance abriendo este enlace:\n${link}\n\nSi no creaste una cuenta, ignorá este mensaje.`,
    });
  }

  /**
   * Solicitud de reset de contraseña (P1.2, @Public). Respuesta CONSTANTE
   * (anti-enumeración): no revela si el email existe. Solo emite un token de
   * reset si el usuario existe y está activo.
   */
  async forgotPassword(body: { email?: string }) {
    const email = (body?.email ?? '').trim().toLowerCase();
    if (email) {
      const user = await this.db.one<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email],
      );
      if (user && user.status === 'active') {
        try {
          await this.sendPasswordResetEmail(user.id, email);
        } catch (err) {
          this.logger.warn(`No se pudo enviar el reset a ${email}: ${String(err)}`);
        }
      }
    }
    return { ok: true };
  }

  /**
   * Establece una contraseña nueva a partir de un token de reset (P1.2, @Public):
   * consume el token (single-use), actualiza `password_hash` y REVOCA todas las
   * sesiones vivas del usuario (decisión F: un cambio de credencial invalida las
   * sesiones existentes). La validación de la contraseña ocurre ANTES de consumir
   * el token — una contraseña débil no quema el token.
   */
  async resetPassword(body: { token?: string; new_password?: string }) {
    const token = (body?.token ?? '').trim();
    const newPassword = body?.new_password ?? '';
    if (!token)
      throw new BadRequestException({ code: 'identity.missing_token', title: 'token es obligatorio' });
    if (newPassword.length < 8)
      throw new BadRequestException({ code: 'identity.weak_password', title: 'La contraseña debe tener al menos 8 caracteres' });

    const userId = await this.tokens.consume(token, 'password_reset');
    if (!userId)
      throw new BadRequestException({ code: 'identity.invalid_token', title: 'Token de reset inválido o expirado' });

    await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hashPassword(newPassword)]);
    await this.auth.revokeAllSessions(userId);
    this.logger.log(`Reset de contraseña completado para user=${userId}`);
    return { ok: true };
  }

  /** Emite un token de reset y envía el email con el link. */
  private async sendPasswordResetEmail(userId: string, email: string): Promise<void> {
    const token = await this.tokens.issue(userId, 'password_reset');
    const link = `${appBaseUrl()}/reset-password?token=${token}`;
    await this.email.send({
      to: email,
      subject: 'Restablecé tu contraseña — Cowinance',
      text: `Recibimos una solicitud para restablecer tu contraseña. Abrí este enlace:\n${link}\n\nSi no lo solicitaste, ignorá este mensaje: tu contraseña no cambió.`,
    });
  }
}
