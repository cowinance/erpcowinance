import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DbService } from '../../db/db.service';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;

/**
 * Relay del Outbox (ADR-0005): drena las filas de event_outbox no publicadas
 * y las emite al transporte in-process (EventEmitter2), DESPUÉS del commit.
 *
 * Poller simple (F5): prioriza simplicidad, observabilidad, testabilidad y
 * bajo acoplamiento sobre latencia. Puede evolucionar a hook post-commit /
 * LISTEN·NOTIFY sin cambiar el puerto ni los emisores.
 *
 * at-least-once: marca `published_at` SOLO tras un `emitAsync` exitoso. Si un
 * consumidor lanza (o el proceso cae) antes de marcar, la fila se reintenta
 * en el próximo tick → los consumidores deben ser idempotentes (dedup por id).
 * Lee sin contexto de tenant (event_outbox no tiene RLS): proceso interno de
 * confianza que drena cross-tenant.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private readonly db: DbService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Drena un lote de eventos pendientes. Público para poder testear sin esperar el timer. */
  async drain(): Promise<void> {
    if (this.draining) return; // sin ticks superpuestos
    this.draining = true;
    try {
      const rows = await this.db.query<{ id: string; type: string; payload: unknown }>(
        `SELECT id, type, payload FROM event_outbox
         WHERE published_at IS NULL ORDER BY created_at LIMIT $1`,
        [BATCH_SIZE],
      );
      for (const row of rows) {
        try {
          await this.eventEmitter.emitAsync(row.type, row.payload);
          await this.db.query(`UPDATE event_outbox SET published_at = now() WHERE id = $1`, [row.id]);
        } catch (err) {
          // No se marca → se reintenta el próximo tick (at-least-once).
          this.logger.warn(`Fallo al publicar evento ${row.id} (${row.type}); se reintentará: ${String(err)}`);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
