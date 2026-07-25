import { Body, Controller, Get, Post } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { IdentityService } from './identity.service';
import { Public } from '../auth/public.decorator';
import { CREDENTIAL_RULES, EMAIL_SEND_RULES, RateLimit } from '../../common/rate-limit.guard';
import { supportedCountries, type CountryOption } from './country-defaults';

@Controller()
export class IdentityController {
  constructor(
    private readonly db: DbService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * Registro self-service (P1.1, ADR-0010). Público: crea identidad + tenant y
   * responde 201. No auto-loguea — el cliente llama después a /auth/login.
   */
  @Public()
  @RateLimit(CREDENTIAL_RULES)
  @Post('register')
  register(@Body() body: any) {
    return this.identity.register(body);
  }

  /** Verificación de email (P1.2). Público: el link del email trae el token. */
  @Public()
  @RateLimit(CREDENTIAL_RULES)
  @Post('verify-email')
  verifyEmail(@Body() body: any) {
    return this.identity.verifyEmail(body);
  }

  /** Reenvío de verificación (P1.2). Público, respuesta constante (anti-enumeración). */
  @Public()
  @RateLimit(EMAIL_SEND_RULES)
  @Post('resend-verification')
  resendVerification(@Body() body: any) {
    return this.identity.resendVerification(body);
  }

  /** Solicitud de reset de contraseña (P1.2). Público, respuesta constante (anti-enumeración). */
  @Public()
  @RateLimit(EMAIL_SEND_RULES)
  @Post('forgot-password')
  forgotPassword(@Body() body: any) {
    return this.identity.forgotPassword(body);
  }

  /** Establecer contraseña nueva con el token de reset (P1.2). Público. */
  @Public()
  @RateLimit(CREDENTIAL_RULES)
  @Post('reset-password')
  resetPassword(@Body() body: any) {
    return this.identity.resetPassword(body);
  }

  /**
   * Países soportados para el registro (P1.3.2, ADR-0012). Público (el form de
   * registro es anónimo): funciona sin cookie ni token. Vista de lectura de la
   * fuente canónica `country-defaults`; DTO explícito `{code, name}`, sin
   * exponer la config interna de provisioning (currency/locale/timezone).
   */
  @Public()
  @Get('catalogs/countries')
  countries(): CountryOption[] {
    return supportedCountries();
  }

  @Get('organizations/current')
  async currentOrganization() {
    return this.db.one(
      `SELECT id, name, legal_name, country_code, default_currency, default_locale, timezone, unit_system
       FROM organizations WHERE id = $1`,
      [this.db.tenant],
    );
  }

  @Get('farms')
  async farms() {
    return this.db.query(
      `SELECT f.id, f.name, f.official_code, f.total_area_ha,
              (SELECT count(*)::int FROM animals a WHERE a.farm_id = f.id AND a.status = 'active' AND a.deleted_at IS NULL) AS active_animals
       FROM farms f WHERE f.tenant_id = $1 AND f.deleted_at IS NULL ORDER BY f.created_at`,
      [this.db.tenant],
    );
  }
}
