import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PlatformDb } from './platform.db';
import { PlatformAuditInterceptor } from './platform-audit.interceptor';
import { verifyPlatformToken, type PlatformActor, type PlatformRole } from './platform-session';

/**
 * Puerta del panel de plataforma. Deja pasar SOLO a un administrador de plataforma vivo.
 *
 * Tres filtros, y ninguno depende de los otros dos:
 *
 *  1. **El token tiene que ser de plataforma.** `verifyPlatformToken` usa la clave derivada, así
 *     que un access token de un `owner` o `admin` de finca —por más válido que sea para el ERP—
 *     ni siquiera verifica la firma. Es la respuesta al requisito «que un owner no entre a
 *     /platform»: no hay chequeo de rol que saltarse, la criptografía no da.
 *  2. **La fila en `platform_admins` se consulta EN CADA REQUEST**, no se confía en el token.
 *     Deshabilitar a alguien (`disabled_at`) tiene efecto en la request siguiente, no cuando venza
 *     su sesión de 30 minutos. Es un round-trip por request, y para un panel interno de baja
 *     frecuencia es un precio ridículo comparado con no poder cortar el acceso de inmediato.
 *  3. **El usuario tiene que seguir activo** en `users`: bloquear la cuenta cierra también el
 *     panel, sin tener que acordarse de tocar las dos tablas.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly pdb: PlatformDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token)
      throw new UnauthorizedException({ code: 'platform.missing_token', title: 'Sesión de plataforma requerida' });

    const payload = verifyPlatformToken(token);
    if (!payload)
      throw new UnauthorizedException({ code: 'platform.invalid_token', title: 'Sesión inválida o vencida' });

    const admin = await this.pdb.read((q) =>
      q.one<{ role: PlatformRole; email: string; full_name: string; status: string }>(
        `SELECT pa.role, u.email, u.full_name, u.status
           FROM platform_admins pa JOIN users u ON u.id = pa.user_id
          WHERE pa.user_id = $1 AND pa.disabled_at IS NULL AND u.deleted_at IS NULL`,
        [payload.sub],
      ),
    );
    if (!admin || admin.status !== 'active') {
      // Se audita el intento: un token de plataforma presentado por alguien que ya no es
      // administrador es exactamente el evento que uno quiere ver en la bitácora.
      await this.pdb.audit({
        actorUserId: payload.sub,
        action: `${req.method} ${req.route?.path ?? req.url}`,
        outcome: 'denied',
        detail: { reason: 'no_es_administrador_de_plataforma' },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      throw new ForbiddenException({ code: 'platform.not_admin', title: 'No sos administrador de plataforma' });
    }

    const actor: PlatformActor = {
      userId: payload.sub,
      role: admin.role,
      email: admin.email,
      name: admin.full_name,
      mfa: payload.mfa,
    };
    req.platformActor = actor;
    return true;
  }
}

export function clientIp(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}

/**
 * Declara un controlador de plataforma. **Usar esto y no `@Controller` a secas.**
 *
 * Junta las tres cosas que una ruta de `/platform` necesita y que por separado se olvidan:
 *
 *  · `@Public()` — para que el `AuthInterceptor` NO exija un token de tenant ni abra la
 *    transacción con `app.tenant_id`. Suena contradictorio en un panel de administración, pero
 *    «public» acá significa «no autenticada por el plano de tenant»; quien autentica es el guard.
 *  · `@UseGuards(PlatformAdminGuard)` — la autenticación de verdad.
 *  · `@UseInterceptors(PlatformAuditInterceptor)` — la bitácora, automática.
 *
 * El riesgo que cierra es concreto: `@Public()` sin el guard sería una ruta ABIERTA. Al no poder
 * escribir una sin la otra, ese error deja de ser posible.
 */
export function PlatformController(path = ''): ClassDecorator {
  return applyDecorators(
    Controller(path ? `platform/${path}` : 'platform'),
    Public(),
    UseGuards(PlatformAdminGuard),
    UseInterceptors(PlatformAuditInterceptor),
  );
}
