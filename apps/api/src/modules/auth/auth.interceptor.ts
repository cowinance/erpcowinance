import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { tagActor } from '../../common/observability';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AccessPayload, JWT_ISSUER, JWT_SECRET } from './auth.service';
import { impersonationOf } from '../platform/impersonation';

/**
 * Autenticación + contexto de tenant por request:
 * 1. Verifica el Bearer JWT (salvo rutas @Public).
 * 2. Abre una transacción y fija `app.tenant_id` con SET LOCAL → la RLS
 *    de Postgres aísla las filas del tenant aunque una query olvide el WHERE.
 * 3. Propaga el actor por AsyncLocalStorage; DbService enruta todas las
 *    queries de la request por esta transacción.
 */
@Injectable()
export class AuthInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException({ code: 'auth.missing_token', title: 'Token de acceso requerido' });

    let payload: AccessPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as AccessPayload;
    } catch {
      throw new UnauthorizedException({ code: 'auth.invalid_token', title: 'Token inválido o vencido' });
    }
    // `impersonation` es una sesión del ERP emitida por el panel de plataforma (modo espejo). Se
    // acepta acá —y no en un camino aparte— justamente para que recorra EXACTAMENTE el mismo código
    // que una sesión normal: si el soporte viera una app distinta de la del cliente, no serviría
    // para reproducir su problema. Lo único que cambia es que la transacción va en solo lectura.
    const espejo = impersonationOf(payload);
    if (payload.typ !== 'access' && !espejo)
      throw new UnauthorizedException({ code: 'auth.invalid_token', title: 'Se esperaba un access token' });

    // El log de acceso se emite cuando la respuesta termina, con la transacción ya cerrada: si no
    // se copia el actor al contexto de observabilidad ahora, esa línea saldría sin tenant.
    tagActor(payload.ten, payload.sub);

    return from(
      this.db.tx(async (q) => {
        // Aislamiento (RLS) + zona horaria de la finca, juntos. La zona es lo que hace que
        // `CURRENT_DATE` y los casts a fecha del sistema entero hablen del día de la finca y no del
        // de UTC: sin esto, después de las 20:00 en Venezuela «hoy» era mañana.
        await this.db.applyTenantContext(q, payload.ten);

        // MODO ESPEJO: la transacción entera pasa a SOLO LECTURA, y lo impone PostgreSQL.
        //
        // Va acá y no en un guard por método HTTP porque en este sistema **varios `GET` escriben**:
        // `/alerts/kpis` evalúa las reglas y guarda alertas, `/notifications/unread-count` genera su
        // ledger si falta, `/billing/subscription` crea el trial la primera vez. Un guard que
        // bloqueara «todo lo que no sea GET» habría dejado pasar justamente esas escrituras,
        // creyendo que las bloqueaba.
        //
        // Se fija DESPUÉS del contexto de tenant: `set_config` es una escritura de sesión, no de
        // datos, pero conviene no depender de ese detalle. Cualquier intento de escribir datos
        // muere con `25006`, que `DbService` traduce a un 403 con explicación.
        if (espejo) await q.query(`SET TRANSACTION READ ONLY`);

        return requestContext.run(
          {
            userId: payload.sub,
            tenantId: payload.ten,
            role: payload.role,
            email: payload.email,
            name: payload.name,
            impersonatedBy: espejo ?? undefined,
            q,
          },
          () => lastValueFrom(next.handle()),
        );
      }),
    );
  }
}
