import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PlatformDb } from './platform.db';
import type { PlatformActor } from './platform-session';

/**
 * Bitácora automática de TODO lo que pasa por el panel de plataforma.
 *
 * Automática y no por decorador a propósito: un `@Audit('...')` por handler funciona hasta que
 * alguien agrega una ruta y no lo pone, y justo esa es la que uno quiere ver en la bitácora. La
 * acción se deriva del método y la ruta (`GET /v1/platform/organizations/:id`), así que una ruta
 * nueva queda auditada por existir.
 *
 * **Se registra la lectura, no solo la escritura.** En la fase 1 no hay escrituras: el valor entero
 * de esta tabla es poder responder «¿quién miró los datos de esta finca, y cuándo?». Los filtros
 * viajan en `detail` porque un buscador con un email tecleado ES el dato interesante de una
 * consulta de soporte.
 *
 * El registro sale DESPUÉS de que el handler respondió bien; los rechazos del guard se auditan allá
 * (con `outcome: 'denied'`), donde todavía se sabe por qué se rechazó.
 */
@Injectable()
export class PlatformAuditInterceptor implements NestInterceptor {
  constructor(private readonly pdb: PlatformDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const actor: PlatformActor | undefined = req.platformActor;

    return next.handle().pipe(
      tap(() => {
        void this.pdb.audit({
          actorUserId: actor?.userId,
          actorEmail: actor?.email,
          actorRole: actor?.role,
          action: `${req.method} ${req.route?.path ?? req.url}`,
          outcome: 'ok',
          targetType: req.params?.id ? 'organization' : null,
          targetId: req.params?.id ?? null,
          targetTenantId: isUuid(req.params?.id) ? req.params.id : null,
          detail: { query: req.query ?? {}, mfa: actor?.mfa ?? false },
          ip: clientIpOf(req),
          userAgent: req.headers?.['user-agent'],
        });
      }),
    );
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

function clientIpOf(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}
