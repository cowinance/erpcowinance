import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * calving_offspring: evento inmutable (insert-once, ON CONFLICT DO NOTHING
 * — sin LWW, sin sync_row_state). Sin lógica de negocio: `vitality ??
 * 'live'` como default — igual que antes de F6.3-B.
 *
 * Vive en `repro/` (ADR-0008). Se auto-registra en `SyncHandlerRegistry`
 * al arrancar (`OnModuleInit`).
 */
@Injectable()
export class CalvingOffspringSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'calving_offspring' as const;

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
      `INSERT INTO calving_offspring (id, tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [op.rowId, t, row['calving_id'], row['animal_id'] ?? null, row['birth_weight_kg'] ?? null, row['vitality'] ?? 'live', this.db.user],
    );
    return [];
  }
}
