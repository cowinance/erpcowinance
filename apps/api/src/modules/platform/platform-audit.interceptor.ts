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

    // Las ESCRITURAS se auditan solas, dentro de su propia transacción y con el motivo, el estado
    // anterior y las sesiones cortadas (`PlatformActionsService`). Registrarlas también acá dejaría
    // dos entradas por acción: una rica y otra que solo dice el verbo y la ruta. Peor todavía, la
    // de acá se escribe DESPUÉS de que la transacción cerró, así que una acción revertida podría
    // quedar igual en la bitácora como si hubiera pasado.
    if (req.method !== 'GET') return next.handle();

    // Y tampoco se registra la FONTANERÍA del propio panel.
    //
    // Medido sobre la bitácora real: de 99 entradas, 75 eran navegación, y 30 de esas eran
    // `GET /me` —que cada página pide para saber qué botones dibujar—. El resultado es que las
    // entradas que justifican que este módulo exista (una suspensión, un modo espejo) quedaban
    // sepultadas y se iban de la ventana en un rato de uso.
    //
    // El criterio para excluir no es «hace ruido» sino **«no mira datos de ningún cliente»**:
    // `/me` es «quién soy yo», `/plans` es el catálogo global de precios y `/audit-log` es esta
    // misma bitácora. Todo lo que sí toca a un cliente —el listado de organizaciones, la ficha de
    // una, el buscador de usuarios— se sigue registrando, porque «quién miró esta finca» es
    // exactamente la pregunta que hay que poder responder.
    if (SIN_AUDITAR.some((r) => (req.route?.path ?? req.url).endsWith(r))) return next.handle();

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

/**
 * Rutas de LECTURA que no se auditan: no consultan datos de ningún cliente.
 *
 * Va como lista explícita y corta, no como patrón: agregar una ruta acá tiene que ser una decisión
 * visible en el diff, porque lo que se decide es dejar algo fuera de la auditoría.
 */
const SIN_AUDITAR = ['/me', '/plans', '/audit-log'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

function clientIpOf(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}
