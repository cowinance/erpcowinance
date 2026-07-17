import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { HealthApplicationError } from '@cowinance/domain';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncConflictWriter } from '../../sync/registry/sync-conflict.writer';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { TreatmentService, HealthApplicationLookupError } from '../treatment.service';

/**
 * treatments: canal de sync ENTRANTE de la aplicación de tratamiento. El móvil
 * captura offline y lo emite como UNA sola intención `event` (event-only); este handler
 * la mapea a la REGLA ÚNICA `TreatmentService.recordTreatment` (origin='sync') — que en
 * una sola tx escribe la fila `treatments` con el retiro DERIVADO, el timeline y el evento
 * de dominio. Ya no reimplementa `computeWithdrawal` ni queda sin línea de tiempo.
 *
 * Server Authority (F4.4/ADR-0007): el retiro que persiste es el del servidor; si difiere
 * del propuesto por el cliente, `recordTreatment` lo reporta en `withdrawalMismatch` y acá se
 * registra como conflicto semántico auto-resuelto (inocuidad alimentaria, sin tolerancia).
 *
 * Idempotente por `treatmentId = op.rowId`. Rechazos de dominio (animal no activo, animal/
 * producto inexistente) → conflicto semántico SIN persistencia parcial. Vive en `health/`
 * (ADR-0008); se auto-registra en `SyncHandlerRegistry` al arrancar.
 */
@Injectable()
export class TreatmentSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'treatments' as const;

  constructor(
    private readonly db: DbService,
    private readonly conflictWriter: SyncConflictWriter,
    private readonly registry: SyncHandlerRegistry,
    private readonly treatments: TreatmentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]> {
    if (op.kind !== 'event') {
      throw new BadRequestException({
        code: 'sync.unsupported_op',
        title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}`,
      });
    }
    const row = op.row;
    const conflicts: SyncConflict[] = [];

    try {
      const res = await this.treatments.recordTreatment(q, {
        animalId: row['animal_id'] as string,
        productId: row['product_id'] as string,
        appliedAt: (row['applied_at'] as string) ?? undefined,
        dose: (row['dose'] as number | null) ?? null,
        doseUnit: (row['dose_unit'] as string | null) ?? null,
        route: (row['route'] as string | null) ?? null,
        diagnosisId: (row['diagnosis_id'] as string | null) ?? null,
        cost: (row['cost'] as number | null) ?? null,
        notes: (row['notes'] as string | null) ?? null,
        actorUserId: this.db.user,
        origin: 'sync',
        treatmentId: op.rowId,
        clientMeatWithdrawalUntil: (row['meat_withdrawal_until'] as string | null) ?? null,
        clientMilkWithdrawalUntil: (row['milk_withdrawal_until'] as string | null) ?? null,
      });
      for (const m of res.withdrawalMismatch) {
        conflicts.push({
          type: 'semantic', entity_id: op.rowId, autoResolved: true,
          detail: `Server recomputation mismatch: ${m.field} client=${m.client ?? 'null'} server=${m.server ?? 'null'}`,
        });
      }
    } catch (e) {
      if (e instanceof HealthApplicationError || e instanceof HealthApplicationLookupError) {
        conflicts.push({ type: 'semantic', entity_id: op.rowId, autoResolved: false, detail: `${e.code}: ${e.reason}` });
      } else {
        throw e;
      }
    }

    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    // autoResolved es una instrucción de persistencia (SyncConflictWriter),
    // no parte del contrato HTTP de /sync/push.
    return conflicts.map(({ autoResolved: _autoResolved, ...c }) => c);
  }
}
