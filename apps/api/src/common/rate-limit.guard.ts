import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitRule, SlidingWindowRateLimiter } from './rate-limit';

export const RATE_LIMIT_KEY = 'cowinance:rate-limit';

/**
 * Marca un handler como limitado. Sin este decorador el guard no hace nada: se aplica a los
 * endpoints públicos de credenciales, no a la API entera (una request autenticada ya está
 * acotada por el plan y por la sesión).
 */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

/** Ventana estándar para credenciales: 10 intentos cada 5 minutos. */
export const CREDENTIAL_RULE: RateLimitRule = { limit: 10, windowMs: 5 * 60_000 };

/** Envío de emails (verificación, reset): más restrictivo — cada intento manda un correo. */
export const EMAIL_RULE: RateLimitRule = { limit: 5, windowMs: 15 * 60_000 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new SlidingWindowRateLimiter();
  private lastPrune = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const req = context.switchToHttp().getRequest();
    const now = Date.now();
    if (now - this.lastPrune > rule.windowMs) {
      this.limiter.prune(now, rule.windowMs);
      this.lastPrune = now;
    }

    // DOS dimensiones, ambas obligatorias:
    //  · por IP     → frena el diccionario clásico contra una cuenta desde un origen.
    //  · por email  → frena el "password spraying": una contraseña común probada contra muchas
    //                 cuentas desde muchas IPs, que la limitación por IP sola no ve.
    const route = `${req.method}:${req.route?.path ?? req.url}`;
    const keys = [`${route}|ip:${clientIp(req)}`];
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    if (email) keys.push(`${route}|email:${email}`);

    for (const key of keys) {
      const decision = this.limiter.hit(key, rule, now);
      if (!decision.allowed) {
        const res = context.switchToHttp().getResponse();
        res?.set?.('Retry-After', String(decision.retryAfterSeconds));
        throw new HttpException(
          {
            code: 'rate_limit.exceeded',
            title: 'Demasiados intentos',
            detail: `Esperá ${decision.retryAfterSeconds} segundos antes de volver a intentar.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}

/**
 * IP del cliente. Detrás de un balanceador, `req.ip` es la del proxy y todos los usuarios
 * compartirían una sola clave: hay que habilitar `TRUST_PROXY` (main.ts) para que Express
 * lea `X-Forwarded-For`. Sin proxy, confiar en esa cabecera sería dejar que el atacante
 * elija su propia clave, así que la decisión es explícita y por configuración.
 */
function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconocida';
}
