import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/**
 * weighings: evento inmutable (insert-once, ON CONFLICT DO NOTHING — sin
 * LWW, sin sync_row_state). Sin lógica de negocio: `device_id` siempre
 * `null` (columna referencia dispositivos IoT de báscula, no el
 * sync_device del móvil — mismo comportamiento que antes de F6.3-B).
 *
 * Vive en `herd/` (ADR-0008): mismo dominio que `herd.service.ts`. Se
 * auto-registra en `SyncHandlerRegistry` al arrancar (`OnModuleInit`).
 */
@Injectable()
export class WeighingSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'weighings' as const;

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
      `INSERT INTO weighings (id, tenant_id, animal_id, weighed_at, weight_kg, method, body_condition, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['animal_id'],
        row['weighed_at'] ?? new Date().toISOString(),
        row['weight_kg'],
        row['method'] ?? 'scale',
        row['body_condition'] ?? null,
        null, // device_id referencia a dispositivos IoT (báscula), no al sync_device
      ],
    );
    return [];
  }
}
