import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RateLimitRule } from './rate-limit';
import { DbService } from '../db/db.service';
import { resolveRateLimitStore, type RateLimitStore } from './rate-limit-store';

export const RATE_LIMIT_KEY = 'cowinance:rate-limit';

/**
 * Marca un handler como limitado. Sin este decorador el guard no hace nada: se aplica a los
 * endpoints públicos de credenciales, no a la API entera (una request autenticada ya está
 * acotada por el plan y por la sesión).
 */
export const RateLimit = (rules: RateLimitRules) => SetMetadata(RATE_LIMIT_KEY, rules);

/**
 * Un límite por DIMENSIÓN, no uno solo para las dos.
 *
 * Las dos dimensiones frenan ataques distintos y toleran cosas distintas:
 *
 *  · **email** — el diccionario contra UNA cuenta. Acá el límite tiene que ser estricto: nadie
 *    tipea mal su contraseña diez veces en cinco minutos.
 *  · **IP** — el *password spraying*: una contraseña común probada contra muchas cuentas. Acá el
 *    límite tiene que ser AMPLIO, porque una IP no es una persona: una finca con veinte empleados
 *    detrás de un mismo NAT entra toda por la misma. Con un límite estricto por IP, el que se
 *    queda afuera es el vigésimo empleado, no el atacante.
 *
 * Que fuera un único límite para ambas era un error: la suite e2e completa —que registra e ingresa
 * decenas de usuarios desde una sola IP— lo destapó fallando en 14 escenarios.
 */
export interface RateLimitRules {
  ip: RateLimitRule;
  email: RateLimitRule;
}

/** Credenciales (login, refresh, registro, reset con token). */
export const CREDENTIAL_RULES: RateLimitRules = {
  ip: { limit: 60, windowMs: 5 * 60_000 },
  email: { limit: 10, windowMs: 5 * 60_000 },
};

/** Endpoints que ENVÍAN un correo: cada intento le llega a una persona real. */
export const EMAIL_SEND_RULES: RateLimitRules = {
  ip: { limit: 30, windowMs: 15 * 60_000 },
  email: { limit: 5, windowMs: 15 * 60_000 },
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store: RateLimitStore;

  constructor(
    private readonly reflector: Reflector,
    db: DbService,
  ) {
    this.store = resolveRateLimitStore(db);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRules>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules) return true;

    const req = context.switchToHttp().getRequest();
    const now = Date.now();

    // Las dos dimensiones se evalúan siempre, cada una con SU límite (ver `RateLimitRules`).
    const route = `${req.method}:${req.route?.path ?? req.url}`;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    const controles: [string, RateLimitRule][] = [[`${route}|ip:${clientIp(req)}`, rules.ip]];
    if (email) controles.push([`${route}|email:${email}`, rules.email]);

    for (const [key, rule] of controles) {
      const decision = await this.store.hit(key, rule, now);
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
