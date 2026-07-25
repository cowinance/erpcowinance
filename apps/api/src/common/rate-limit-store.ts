import { Logger } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import { SlidingWindowRateLimiter, type RateLimitDecision, type RateLimitRule } from './rate-limit';

/**
 * Dónde se cuentan los intentos.
 *
 * El limitador original contaba en la memoria del proceso: correcto con una instancia, y silencioso
 * y equivocado con varias — el límite efectivo se multiplica por la cantidad de instancias, que es
 * justo lo que un atacante necesita. La REGLA (ventana deslizante, el intento rechazado no cuenta)
 * no cambia; lo que cambia es dónde vive el contador.
 */
export interface RateLimitStore {
  readonly kind: string;
  hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision>;
}

/** En proceso. Correcto —y más barato— cuando hay una sola instancia. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memoria';
  private readonly limiter = new SlidingWindowRateLimiter();
  private lastPrune = 0;

  async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision> {
    if (now - this.lastPrune > rule.windowMs) {
      this.limiter.prune(now, rule.windowMs);
      this.lastPrune = now;
    }
    return this.limiter.hit(key, rule, now);
  }
}

/**
 * Contador compartido en PostgreSQL. Se elige la base y no Redis porque la base ya está: sumar un
 * servicio nuevo —con su despliegue, su backup y su modo de falla— para contar intentos de login
 * sería pagar mucho por poco.
 *
 * Las tres sentencias van en UNA transacción para que contar y registrar sean atómicos: sin eso,
 * dos requests simultáneas podrían leer el mismo conteo y pasar las dos.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  readonly kind = 'postgres';
  private readonly logger = new Logger('RateLimit');
  private readonly memoria = new InMemoryRateLimitStore();

  constructor(private readonly db: DbService) {}

  async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision> {
    const desde = new Date(now - rule.windowMs).toISOString();
    const ahora = new Date(now).toISOString();
    try {
      return await this.db.tx(async (q) => {
        // Limpieza oportunista: la ventana es de minutos, así que borrar lo vencido de esta clave
        // en cada intento alcanza para que la tabla no crezca. Sin job de limpieza.
        await q.query(`DELETE FROM rate_limit_hits WHERE key = $1 AND at <= $2::timestamptz`, [key, desde]);
        const rows = await q.query<{ n: number; primero: string | null }>(
          `SELECT count(*)::int AS n, min(at)::text AS primero FROM rate_limit_hits WHERE key = $1`,
          [key],
        );
        const { n, primero } = rows[0];

        if (n >= rule.limit) {
          // El intento rechazado NO se registra: si contara, martillar extendería el bloqueo para
          // siempre y el usuario legítimo detrás de la misma IP no volvería a entrar.
          const vence = new Date(primero!).getTime() + rule.windowMs;
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((vence - now) / 1000)),
            remaining: 0,
          };
        }

        await q.query(`INSERT INTO rate_limit_hits (key, at) VALUES ($1, $2::timestamptz)`, [key, ahora]);
        return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - (n + 1) };
      });
    } catch (e) {
      // Fail-OPEN, y a propósito: si la base no responde, `/auth/login` ya está caído de todos
      // modos. Rechazar acá no protegería nada y convertiría un incidente de base en un bloqueo
      // total del login incluso cuando la base vuelva. Se degrada al contador en memoria —que
      // sigue limitando, solo que por instancia— y se deja registro de por qué.
      this.logger.warn(`Contador compartido no disponible, se limita en memoria: ${(e as Error).message}`);
      return this.memoria.hit(key, rule, now);
    }
  }
}

/**
 * Elige el almacén. Por defecto: PostgreSQL cuando hay `DATABASE_URL` (o sea, un despliegue real,
 * que puede tener más de una instancia) y memoria cuando se corre sobre PGlite (desarrollo, un
 * proceso). `RATE_LIMIT_STORE` fuerza uno u otro.
 */
export function resolveRateLimitStore(db: DbService, env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const elegido = env.RATE_LIMIT_STORE?.trim().toLowerCase() || (env.DATABASE_URL ? 'postgres' : 'memory');
  switch (elegido) {
    case 'memory':
      return new InMemoryRateLimitStore();
    case 'postgres':
      return new PostgresRateLimitStore(db);
    default:
      throw new Error(`RATE_LIMIT_STORE desconocido: "${elegido}". Valores: memory, postgres`);
  }
}
