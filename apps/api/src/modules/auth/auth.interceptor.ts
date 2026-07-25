import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { tagActor } from '../../common/observability';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AccessPayload, JWT_ISSUER, JWT_SECRET } from './auth.service';

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
    if (payload.typ !== 'access')
      throw new UnauthorizedException({ code: 'auth.invalid_token', title: 'Se esperaba un access token' });

    // El log de acceso se emite cuando la respuesta termina, con la transacción ya cerrada: si no
    // se copia el actor al contexto de observabilidad ahora, esa línea saldría sin tenant.
    tagActor(payload.ten, payload.sub);

    return from(
      this.db.tx(async (q) => {
        await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [payload.ten]);
        return requestContext.run(
          { userId: payload.sub, tenantId: payload.ten, role: payload.role, email: payload.email, name: payload.name, q },
          () => lastValueFrom(next.handle()),
        );
      }),
    );
  }
}
