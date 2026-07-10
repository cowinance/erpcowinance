import { BadRequestException, Injectable } from '@nestjs/common';
import { computeWithdrawal } from '@cowinance/domain';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../sync-handler';
import { SyncConflictWriter } from '../sync-conflict-writer';

/**
 * treatments: evento inmutable (insert-once, ON CONFLICT DO NOTHING — sin
 * LWW, sin sync_row_state). Server Authority (F4.4/ADR-0007):
 * meat_withdrawal_until/milk_withdrawal_until son derivados por regla de
 * dominio, no una preferencia del cliente — el servidor los recalcula y, si
 * difieren, usa su valor y deja traza (sin tolerancia: inocuidad alimentaria).
 *
 * Piloto de F6 (SyncHandler registry, ver docs/sprints — análisis F6 §5):
 * el candidato más simple con lógica real, para probar el contrato del
 * registry sin mezclarlo todavía con la complejidad de LWW (animals,
 * pregnancies quedan en sync.service.ts hasta la próxima oleada).
 */
@Injectable()
export class TreatmentSyncHandler implements SyncHandler {
  readonly table = 'treatments' as const;

  constructor(
    private readonly db: DbService,
    private readonly conflictWriter: SyncConflictWriter,
  ) {}

  async apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]> {
    if (op.kind !== 'event') {
      throw new BadRequestException({
        code: 'sync.unsupported_op',
        title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}`,
      });
    }
    const t = this.db.tenant;
    const row = op.row;
    const conflicts: SyncConflict[] = [];

    let meatWithdrawalUntil = (row['meat_withdrawal_until'] as string | null) ?? null;
    let milkWithdrawalUntil = (row['milk_withdrawal_until'] as string | null) ?? null;
    const product = await q.one<any>(
      `SELECT withdrawal_meat_days, withdrawal_milk_hours FROM products_veterinary
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [row['product_id'], t],
    );
    if (product) {
      const appliedAt = new Date((row['applied_at'] as string) ?? new Date().toISOString());
      const computed = computeWithdrawal(appliedAt, product.withdrawal_meat_days, product.withdrawal_milk_hours);
      if (computed.meatWithdrawalUntil !== meatWithdrawalUntil) {
        conflicts.push({
          type: 'semantic',
          entity_id: op.rowId,
          detail: `Server recomputation mismatch: meat_withdrawal_until client=${meatWithdrawalUntil ?? 'null'} server=${computed.meatWithdrawalUntil ?? 'null'}`,
          autoResolved: true,
        });
      }
      if (computed.milkWithdrawalUntil !== milkWithdrawalUntil) {
        conflicts.push({
          type: 'semantic',
          entity_id: op.rowId,
          detail: `Server recomputation mismatch: milk_withdrawal_until client=${milkWithdrawalUntil ?? 'null'} server=${computed.milkWithdrawalUntil ?? 'null'}`,
          autoResolved: true,
        });
      }
      meatWithdrawalUntil = computed.meatWithdrawalUntil;
      milkWithdrawalUntil = computed.milkWithdrawalUntil;
    }

    await q.query(
      `INSERT INTO treatments (id, tenant_id, animal_id, product_id, applied_at, dose, dose_unit, route, meat_withdrawal_until, milk_withdrawal_until, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [
        op.rowId,
        t,
        row['animal_id'],
        row['product_id'],
        row['applied_at'] ?? new Date().toISOString(),
        row['dose'] ?? null,
        row['dose_unit'] ?? null,
        row['route'] ?? null,
        meatWithdrawalUntil,
        milkWithdrawalUntil,
        row['notes'] ?? null,
        this.db.user,
      ],
    );

    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    // autoResolved es una instrucción de persistencia (SyncConflictWriter),
    // no parte del contrato HTTP de /sync/push — antes de F6.1 esta rama no
    // exponía ese campo en la respuesta (verificado por comparación directa
    // antes/después); se preserva ese shape acá.
    return conflicts.map(({ autoResolved: _autoResolved, ...c }) => c);
  }
}
