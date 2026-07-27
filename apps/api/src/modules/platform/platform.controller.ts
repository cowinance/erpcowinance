import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CREDENTIAL_RULES, RateLimit } from '../../common/rate-limit.guard';
import { PlatformService, type OrganizationFilters, type UserFilters } from './platform.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformActionsService } from './platform-actions.service';
import { actionsFor } from './platform-permissions';
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

  /**
   * Quién soy y QUÉ PUEDO HACER. Las acciones viajan resueltas por el servidor para que el panel no
   * dibuje botones que van a terminar en 403 — y, sobre todo, para que la regla de permisos no
   * quede escrita dos veces con riesgo de divergir.
   */
  @Get('me')
  me(@Req() req: Request & { platformActor: PlatformActor }) {
    return { ...req.platformActor, actions: actionsFor(req.platformActor.role) };
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

  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.platform.auditLog(Number(limit) || 100);
  }
}

/**
 * Acciones del panel — FASE 2. Cambios de estado reversibles sobre la cuenta.
 *
 * `POST` y no `PATCH`: son TRANSICIONES con nombre («suspender», «reactivar»), no ediciones de un
 * recurso. La ruta dice qué pasa; un `PATCH {status:'suspended'}` invitaría a mandar cualquier
 * columna y a que el servidor decidiera cuáles acepta.
 *
 * Las tres restricciones que aplican a TODAS:
 *   · motivo obligatorio (queda en la bitácora, dentro de la misma transacción),
 *   · el rol tiene que permitirlo (`platform-permissions.ts`),
 *   · nada de esto toca `billing_payments`, que sigue en solo lectura por policy.
 */
@PlatformController()
export class PlatformActionsController {
  constructor(private readonly acciones: PlatformActionsService) {}

  @Post('organizations/:id/suspend')
  suspend(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.suspendOrganization(req.platformActor, id, body);
  }

  @Post('organizations/:id/reactivate')
  reactivate(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.reactivateOrganization(req.platformActor, id, body);
  }

  @Post('organizations/:id/plan')
  changePlan(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.changePlan(req.platformActor, id, body);
  }

  @Post('users/:id/block')
  block(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.blockUser(req.platformActor, id, body);
  }

  @Post('users/:id/unblock')
  unblock(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.unblockUser(req.platformActor, id, body);
  }

  /**
   * MODO ESPEJO. Devuelve una sesión del ERP de 10 minutos y SOLO LECTURA.
   *
   * La respuesta lleva el token en el cuerpo, no en una cookie: quien lo consume es el route
   * handler de la web, del lado del servidor, que lo guarda como cookie `HttpOnly`. Así el token
   * de la finca nunca pasa por el JavaScript del navegador, igual que el resto de las sesiones.
   */
  @Post('users/:id/impersonate')
  impersonate(@Req() req: Request & { platformActor: PlatformActor }, @Param('id') id: string, @Body() body: any) {
    return this.acciones.impersonate(req.platformActor, id, body);
  }

  /** Cierra la sesión de espejo EN LA BITÁCORA (el token vence solo; ver el servicio). */
  @Post('impersonation/end')
  endImpersonation(@Req() req: Request & { platformActor: PlatformActor }, @Body() body: any) {
    return this.acciones.endImpersonation(req.platformActor, body);
  }
}
