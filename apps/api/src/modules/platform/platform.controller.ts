import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CREDENTIAL_RULES, RateLimit } from '../../common/rate-limit.guard';
import { PlatformService, type OrganizationFilters, type UserFilters } from './platform.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformController, clientIp } from './platform-admin.guard';
import type { PlatformActor } from './platform-session';

/**
 * Login del panel. Es el ÚNICO controlador de `/platform` sin `PlatformAdminGuard` —no puede
 * tenerlo, es el que crea la sesión— y por eso se declara con `@Controller` + `@Public()` a mano
 * en vez de con `@PlatformController`. La excepción es visible en una sola línea; el resto de las
 * rutas no puede escribirse sin guard aunque uno quiera.
 *
 * `CREDENTIAL_RULES` es el mismo límite que el login del ERP: sin él, este endpoint es el mejor
 * lugar del sistema para probar contraseñas con diccionario, porque quien entra acá ve TODAS las
 * fincas.
 */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @RateLimit(CREDENTIAL_RULES)
  @Post('login')
  login(@Body() body: any, @Req() req: Request) {
    return this.auth.login(body, { ip: clientIp(req as any), userAgent: req.headers['user-agent'] });
  }
}

/**
 * Rutas de lectura del panel de plataforma.
 *
 * FASE 1: no hay ni un `@Post`/`@Patch`/`@Delete` acá, y no es solo disciplina — la policy
 * `platform_read` es `FOR SELECT`, así que una escritura cross-tenant sería denegada por la base
 * aunque alguien agregara el handler. Suspender cuentas, cambiar planes, impersonar o tocar pagos
 * son fase 2 y van a necesitar, además del endpoint, una decisión explícita sobre la policy.
 */
@PlatformController()
export class PlatformReadController {
  constructor(private readonly platform: PlatformService) {}

  /** Quién soy: lo usa el panel para el encabezado y para saber qué rol tiene la sesión. */
  @Get('me')
  me(@Req() req: Request & { platformActor: PlatformActor }) {
    return req.platformActor;
  }

  @Get('dashboard')
  dashboard() {
    return this.platform.dashboard();
  }

  @Get('organizations')
  organizations(@Query() query: OrganizationFilters) {
    return this.platform.organizations(query);
  }

  // La ruta estática va ANTES de `:id`: al revés, `/organizations/…` capturaría cualquier cosa.
  // (Mismo orden que en `herd`, donde este error ya costó una sesión de diagnóstico.)
  @Get('organizations/:id')
  organization(@Param('id') id: string) {
    return this.platform.organization(id);
  }

  @Get('users')
  users(@Query() query: UserFilters) {
    return this.platform.users(query);
  }

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.platform.auditLog(Number(limit) || 100);
  }
}
