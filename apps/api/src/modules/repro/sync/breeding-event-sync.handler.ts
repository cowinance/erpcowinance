import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * breeding_events: evento inmutable (insert-once, ON CONFLICT DO NOTHING —
 * sin LWW, sin sync_row_state). Sin lógica de negocio: `type ?? 'heat'`
 * como default, igual que antes de F6.3-B.
 *
 * Vive en `repro/` (ADR-0008): mismo dominio que `repro.service.ts`. Se
 * auto-registra en `SyncHandlerRegistry` al arrancar (`OnModuleInit`).
 */
@Injectable()
export class BreedingEventSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'breeding_events' as const;

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
      `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, sire_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['animal_id'],
        row['type'] ?? 'heat',
        row['occurred_at'] ?? new Date().toISOString(),
        row['sire_id'] ?? null,
        row['notes'] ?? null,
        this.db.user,
      ],
    );
    return [];
  }
}
