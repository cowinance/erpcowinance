import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * calvings: evento inmutable (insert-once, ON CONFLICT DO NOTHING — sin
 * LWW, sin sync_row_state). Sin lógica de negocio: `calving_date` truncado
 * a fecha (`.slice(0,10)`), `offspring_count ?? 1` — igual que antes de
 * F6.3-B.
 *
 * Vive en `repro/` (ADR-0008). Se auto-registra en `SyncHandlerRegistry`
 * al arrancar (`OnModuleInit`).
 */
@Injectable()
export class CalvingSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'calvings' as const;

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
      `INSERT INTO calvings (id, tenant_id, pregnancy_id, dam_id, calving_date, ease, offspring_count, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['pregnancy_id'] ?? null,
        row['dam_id'],
        (row['calving_date'] as string) ?? (await this.db.today(q)),
        row['ease'] ?? null,
        row['offspring_count'] ?? 1,
        row['notes'] ?? null,
        this.db.user,
      ],
    );
    return [];
  }
}
