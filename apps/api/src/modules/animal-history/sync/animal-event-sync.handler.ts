import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * animal_events: línea de tiempo inmutable del animal (evento, insert-once,
 * ON CONFLICT DO NOTHING — sin LWW, sin sync_row_state). Sin lógica de
 * negocio: cualquier dominio (health, repro, land, y a futuro genética,
 * IoT, IA) escribe acá sin que este handler conozca de dónde viene el
 * evento — el payload es opaco.
 *
 * Vive en `animal-history/` (ADR-0009), no en `sync/` ni en ningún módulo
 * de dominio: es un subdominio genérico transversal, no propiedad de un
 * bounded context de negocio (herd/health/repro). Se auto-registra en
 * `SyncHandlerRegistry` al arrancar (`OnModuleInit`, mismo patrón de
 * ADR-0008) — `sync/` nunca importa este módulo.
 */
@Injectable()
export class AnimalEventSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'animal_events' as const;

  constructor(
    private readonly db: DbService,
    private readonly registry: SyncHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op): Promise<SyncConflict[]> {
    if (op.kind !== 'event') {
      throw new BadRequestException({
        code: 'sync.unsupported_op',
        title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}`,
      });
    }
    const t = this.db.tenant;
    const row = op.row;
    await q.query(
      `INSERT INTO animal_events (id, tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['animal_id'],
        row['event_type'] ?? 'note',
        JSON.stringify(row['payload'] ?? {}),
        row['occurred_at'] ?? new Date().toISOString(),
        row['recorded_at'] ?? new Date().toISOString(),
      ],
    );
    return [];
  }
}
