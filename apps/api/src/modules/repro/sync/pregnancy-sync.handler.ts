import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { applyPut, HlcClock } from '@cowinance/sync-core';
import type { Op, RowState } from '@cowinance/sync-core';
import { computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis } from '@cowinance/domain';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncConflictWriter } from '../../sync/registry/sync-conflict.writer';
import { SyncVersionStore } from '../../sync/registry/sync-version.store';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

/** Columnas de pregnancies que un changeset puede escribir (diagnóstico/cierre offline). */
const PREGNANCY_FIELDS = new Set(['animal_id', 'status', 'diagnosis_date', 'expected_due_date', 'method', 'closed_at']);

/**
 * pregnancies: put con LWW por campo. El diagnóstico offline crea la fila;
 * el parto/aborto la cierra. Reglas de dominio de repro: Server Authority
 * sobre `expected_due_date` (F4.4/ADR-0007) y detección de preñez
 * concurrente.
 *
 * Vive en `repro/` (ADR-0008). Se auto-registra en `SyncHandlerRegistry`
 * al arrancar (`OnModuleInit`). Usa SyncVersionStore / SyncConflictWriter
 * compartidos; arma el RowState acá porque conoce las reglas del agregado.
 *
 * `serverClock`: nodo HLC del servidor (ADR-0007), un participante más del
 * sistema distribuido — mismo mecanismo que los dispositivos, con
 * node='server'. Vive acá porque hoy pregnancies es su ÚNICO consumidor
 * (Server Authority). Si aparece un segundo dominio con Server Authority
 * (genética/IoT/IA — nombrados en ADR-0007), se evaluará extraerlo a un
 * servicio compartido; hasta entonces, abstracción mínima (YAGNI).
 */
@Injectable()
export class PregnancySyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'pregnancies' as const;

  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly conflictWriter: SyncConflictWriter,
    private readonly registry: SyncHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]> {
    if (op.kind !== 'put') {
      throw new BadRequestException({
        code: 'sync.unsupported_op',
        title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}`,
      });
    }
    // autoResolved: true → server_wins inmediato (F4.4, no espera revisión humana).
    // false/ausente → sigue el flujo existente (pendiente en el panel de flota).
    const conflicts: SyncConflict[] = [];
    const t = this.db.tenant;

    const versionsMap = await this.versions.read(q, this.table, op.rowId);
    const existing = await q.one<any>(
      `SELECT id, status, animal_id, diagnosis_date FROM pregnancies WHERE id = $1 AND tenant_id = $2`,
      [op.rowId, t],
    );
    const prev: RowState | undefined = versionsMap
      ? { fields: { status: existing?.status }, versions: versionsMap }
      : undefined;
    const { state, changed } = applyPut(prev ?? { fields: {}, versions: {} }, op);

    // Server Authority (F4.4, ADR-0007): expected_due_date es derivado, no una
    // preferencia del cliente. Si esta op lo toca (creación o corrección) y el
    // servidor conoce al animal, recalcula con la función de dominio; si
    // difiere de lo propuesto, corrige y deja traza — sin tolerancia.
    let expectedDueToWrite = (op.fields['expected_due_date'] as string | null | undefined) ?? null;
    const touchesExpectedDue = !existing ? 'expected_due_date' in op.fields : changed.includes('expected_due_date');
    if (touchesExpectedDue) {
      const animalId = (existing?.animal_id ?? op.fields['animal_id']) as string | undefined;
      const diagnosisDate = ((op.fields['diagnosis_date'] as string) ?? existing?.diagnosis_date ?? new Date().toISOString().slice(0, 10)) as string;
      if (typeof animalId === 'string') {
        const lastService = await q.one<any>(
          `SELECT occurred_at FROM breeding_events
           WHERE animal_id = $1 AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL
             AND occurred_at <= $2::date + 1
           ORDER BY occurred_at DESC LIMIT 1`,
          [animalId, diagnosisDate],
        );
        const recomputed = lastService
          ? computeExpectedDueDateFromService(new Date(lastService.occurred_at))
          : computeExpectedDueDateFromDiagnosis(new Date(diagnosisDate));

        if (recomputed !== expectedDueToWrite) {
          conflicts.push({
            type: 'semantic',
            entity_id: op.rowId,
            detail: `Server recomputation mismatch: expected_due_date client=${expectedDueToWrite ?? 'null'} server=${recomputed}`,
            autoResolved: true,
          });
          // La corrección participa del mismo mecanismo de HLC que los
          // dispositivos (no un UPDATE por fuera de él) — así un push
          // posterior con HLC menor no la pisa, y uno genuinamente más
          // nuevo del cliente sí puede ganarle (LWW correcto).
          state.versions['expected_due_date'] = this.serverClock.tick();
        }
        expectedDueToWrite = recomputed;
        state.fields['expected_due_date'] = expectedDueToWrite;
      }
    }

    if (!existing) {
      const animalId = op.fields['animal_id'];
      if (typeof animalId !== 'string')
        throw new BadRequestException({ code: 'sync.pregnancy_missing_animal', title: 'La preñez nueva requiere animal_id' });

      // Conflicto semántico: dos diagnósticos concurrentes → dos preñeces abiertas
      const open = await q.one<any>(
        `SELECT id FROM pregnancies WHERE tenant_id = $1 AND animal_id = $2 AND status = 'open' AND deleted_at IS NULL AND id != $3`,
        [t, animalId, op.rowId],
      );
      if (open && (op.fields['status'] ?? 'open') === 'open') {
        conflicts.push({
          type: 'semantic',
          entity_id: op.rowId,
          detail: 'Diagnóstico de preñez concurrente: el animal ya tiene otra preñez abierta — revisar',
        });
      }
      await q.query(
        `INSERT INTO pregnancies (id, tenant_id, animal_id, diagnosis_date, method, expected_due_date, status, closed_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [
          op.rowId,
          t,
          animalId,
          (op.fields['diagnosis_date'] as string) ?? new Date().toISOString().slice(0, 10),
          op.fields['method'] ?? 'ultrasound',
          expectedDueToWrite,
          op.fields['status'] ?? 'open',
          op.fields['closed_at'] ?? null,
          this.db.user,
        ],
      );
    } else {
      const columns = changed.filter((f) => PREGNANCY_FIELDS.has(f) && f !== 'animal_id');
      if (columns.length) {
        const sets = columns.map((c, i) => `"${c}" = $${i + 3}`).join(', ');
        await q.query(`UPDATE pregnancies SET ${sets}, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
          op.rowId,
          t,
          ...columns.map((c) => (c === 'expected_due_date' ? expectedDueToWrite : op.fields[c])),
        ]);
      }
    }

    await this.versions.write(q, this.table, op.rowId, state.versions);
    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    return conflicts;
  }
}
