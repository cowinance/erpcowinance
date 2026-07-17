import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { HealthApplicationError } from '@cowinance/domain';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncConflictWriter } from '../../sync/registry/sync-conflict.writer';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { VaccinationService } from '../vaccination.service';
import { HealthApplicationLookupError } from '../treatment.service';

/**
 * vaccinations: canal de sync ENTRANTE de la aplicación de vacuna. Mapea la intención
 * `event` a la REGLA ÚNICA `VaccinationService.recordVaccination` (origin='sync') — que en
 * una sola tx escribe la fila `vaccinations` y el timeline (antes el sync no escribía línea
 * de tiempo). Idempotente por `vaccinationId = op.rowId`.
 *
 * Rechazos de dominio (animal no activo, animal/producto inexistente, producto que no es
 * vacuna) → conflicto semántico SIN persistencia parcial. Vive en `health/` (ADR-0008); se
 * auto-registra en `SyncHandlerRegistry` al arrancar.
 */
@Injectable()
export class VaccinationSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'vaccinations' as const;

  constructor(
    private readonly db: DbService,
    private readonly conflictWriter: SyncConflictWriter,
    private readonly registry: SyncHandlerRegistry,
    private readonly vaccinations: VaccinationService,
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
      await this.vaccinations.recordVaccination(q, {
        animalId: row['animal_id'] as string,
        productId: row['product_id'] as string,
        appliedAt: (row['applied_at'] as string) ?? undefined,
        dose: (row['dose'] as number | null) ?? null,
        doseUnit: (row['dose_unit'] as string | null) ?? null,
        batchNumber: (row['batch_number'] as string | null) ?? null,
        nextDueDate: (row['next_due_date'] as string | null) ?? null,
        planId: (row['plan_id'] as string | null) ?? null,
        actorUserId: this.db.user,
        origin: 'sync',
        vaccinationId: op.rowId,
      });
    } catch (e) {
      if (e instanceof HealthApplicationError || e instanceof HealthApplicationLookupError) {
        conflicts.push({ type: 'semantic', entity_id: op.rowId, autoResolved: false, detail: `${e.code}: ${e.reason}` });
      } else {
        throw e;
      }
    }

    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    return conflicts.map(({ autoResolved: _autoResolved, ...c }) => c);
  }
}
