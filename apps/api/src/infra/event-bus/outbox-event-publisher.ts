import { Injectable } from '@nestjs/common';
import type { DomainEvent } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import type { EventPublisher } from '../../application/ports/event-publisher.port';

/**
 * Adaptador outbox-backed del puerto `EventPublisher` (ADR-0005).
 *
 * `publish()` NO emite al bus: inserta la fila de outbox usando `this.db`,
 * que enruta por el handle transaccional de la request en curso (mismo `q`
 * del requestContext que usan SyncConflictWriter/SyncVersionStore). Así el
 * evento y el cambio de negocio son una sola unidad atómica — si la tx se
 * revierte, la fila desaparece (no hay evento fantasma). El `OutboxRelay`
 * publica al transporte después del commit.
 */
@Injectable()
export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly db: DbService) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO event_outbox (id, tenant_id, type, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [event.eventId, this.db.tenant, event.type, JSON.stringify(event), event.occurredAt],
    );
  }
}
