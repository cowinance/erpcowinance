/**
 * Ventana deslizante en memoria para limitar intentos en los endpoints públicos de credenciales
 * (login, refresh, registro, reset de contraseña).
 *
 * Sin esto, `POST /v1/auth/login` acepta intentos ilimitados: con un diccionario y una conexión
 * se prueba cualquier contraseña. El costo de scrypt encarece cada intento (~90 ms), pero no lo
 * impide — solo un límite lo hace.
 *
 * ALCANCE: el contador vive EN EL PROCESO. Con varias instancias detrás de un balanceador, el
 * límite efectivo se multiplica por la cantidad de instancias. Es la mitigación correcta para el
 * despliegue de una sola instancia y una base honesta para moverlo a Redis/Postgres cuando haya
 * varias; lo que NO es aceptable es no tener límite. El contador se elige explícito y puro para
 * que esa migración sea cambiar el almacén, no la regla.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos hasta que el siguiente intento sería aceptado (0 si está permitido). */
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimitRule {
  /** Intentos permitidos dentro de la ventana. */
  limit: number;
  /** Tamaño de la ventana en milisegundos. */
  windowMs: number;
}

export class SlidingWindowRateLimiter {
  /** clave → timestamps de los intentos vivos, en orden ascendente. */
  private readonly hits = new Map<string, number[]>();

  /**
   * Registra un intento y decide. Cuando se rechaza NO se registra el intento: si contara,
   * un atacante que siguiera martillando extendería su propio bloqueo indefinidamente y el
   * usuario legítimo detrás de la misma IP nunca recuperaría el acceso.
   */
  hit(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
    const cutoff = now - rule.windowMs;
    const live = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (live.length >= rule.limit) {
      this.hits.set(key, live);
      const retryAfterMs = live[0] + rule.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)), remaining: 0 };
    }

    live.push(now);
    this.hits.set(key, live);
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - live.length };
  }

  /** Borra las claves sin intentos vivos. El guard la llama de a ratos para no acumular memoria. */
  prune(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }

  /** Solo para tests. */
  get size(): number {
    return this.hits.size;
  }
}
