import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { requestContext } from '../request-context';
import { IS_PUBLIC_KEY } from '../../modules/auth/public.decorator';
import { accessFor, ruleFor } from './capabilities';
import { permite } from './matrix';

/**
 * Autorización por rol. Deniega por defecto.
 *
 * ## Por qué es un INTERCEPTOR y no un guard
 *
 * Porque necesita el rol, y el rol lo pone `AuthInterceptor` en el `requestContext`. Los guards de
 * Nest corren ANTES que los interceptores —el propio `AuthModule` lo documenta al registrar el de
 * rate limit—, así que un guard llegaría con el contexto vacío y tendría que verificar el JWT por
 * su cuenta: dos lugares distintos verificando la misma firma, que es exactamente la clase de
 * duplicación que termina en que uno de los dos queda desactualizado.
 *
 * **Depende del ORDEN de registro**: tiene que ir después de `AuthInterceptor` en el mismo array
 * de providers. Un test verifica esa posición, porque invertirla no rompe nada visible — solo
 * deja de autorizar.
 *
 * ## Por qué la ruta se lee de la metadata de Nest y no de Express
 *
 * `req.route.path` depende del adaptador HTTP y del prefijo global. La metadata (`PATH_METADATA`
 * de la clase + la del handler) es la ruta tal como se DECLARÓ, que es sobre lo que razona
 * `capabilities.ts` — y es lo mismo que puede leer un test sin levantar un servidor.
 *
 * ## Qué NO hace
 *
 * No aísla por tenant: de eso se encarga la RLS, con 140 policies, y es una pregunta distinta
 * —de qué finca son estos datos—. Mezclarlas convertiría cada cambio de permiso en una migración.
 */
@Injectable()
export class PermissionsInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Las rutas públicas no tienen actor. Incluye el panel de plataforma, que se declara
    // `@Public()` y tiene su propia puerta (`PlatformAdminGuard`): un token de finca ni siquiera
    // verifica la firma allá, así que no hay nada que autorizar acá.
    const publica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publica) return next.handle();

    const ctx = requestContext.getStore();
    if (!ctx) {
      // Sin contexto y sin ser pública: o el orden de los interceptores está mal, o alguien llegó
      // por un camino que no pasa por la autenticación. Las dos cosas son un error de programación
      // y ninguna es motivo para dejar pasar la request.
      throw new ForbiddenException({
        code: 'permission.sin_contexto',
        title: 'No se pudo determinar el rol de la sesión',
      });
    }

    const path = this.declaredPath(context);
    const rule = ruleFor(path);
    if (!rule) {
      // Ruta sin capacidad declarada. Es un agujero de configuración, no un permiso denegado —por
      // eso el mensaje dice qué hacer y el test de cobertura lo agarra antes de que llegue acá.
      throw new ForbiddenException({
        code: 'permission.ruta_sin_capacidad',
        title: `La ruta «${path}» no tiene capacidad asignada`,
        detail: 'Agregá una regla en common/permissions/capabilities.ts.',
      });
    }

    const metodo = context.switchToHttp().getRequest()?.method ?? 'GET';
    const nivel = accessFor(metodo, rule);
    if (!permite(ctx.role, rule.cap, nivel)) {
      throw new ForbiddenException({
        code: 'permission.denegado',
        title: 'Tu rol no tiene permiso para esta acción',
        detail: `El rol «${ctx.role}» no puede ${nivel === 'read' ? 'ver' : 'modificar'} ${rule.cap}.`,
      });
    }

    return next.handle();
  }

  /** Ruta declarada = prefijo del controlador + path del handler, sin el prefijo global `v1`. */
  private declaredPath(context: ExecutionContext): string {
    const delControlador = this.reflector.get<string>(PATH_METADATA, context.getClass()) ?? '';
    const delHandler = this.reflector.get<string>(PATH_METADATA, context.getHandler()) ?? '';
    return [delControlador, delHandler]
      .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
      .filter((p) => p && p !== '/')
      .join('/');
  }
}
