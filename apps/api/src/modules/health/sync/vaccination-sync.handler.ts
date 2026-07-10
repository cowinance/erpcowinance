import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * vaccinations: evento inmutable (insert-once, ON CONFLICT DO NOTHING — sin
 * LWW, sin sync_row_state). Sin lógica de negocio propia hoy: a diferencia
 * de `treatments`, mobile nunca envía `next_due_date` por sync (solo el
 * camino REST lo calcula) — no hay valor derivado que verificar acá.
 *
 * Vive en `health/` (ADR-0008): mismo dominio que `health.service.ts` y
 * `TreatmentSyncHandler`. Se auto-registra en `SyncHandlerRegistry` al
 * arrancar (`OnModuleInit`).
 */
@Injectable()
export class VaccinationSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'vaccinations' as const;

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
      `INSERT INTO vaccinations (id, tenant_id, animal_id, product_id, applied_at, dose, dose_unit, batch_number, next_due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['animal_id'],
        row['product_id'],
        row['applied_at'] ?? new Date().toISOString(),
        row['dose'] ?? null,
        row['dose_unit'] ?? null,
        row['batch_number'] ?? null,
        row['next_due_date'] ?? null,
        this.db.user,
      ],
    );
    return [];
  }
}
