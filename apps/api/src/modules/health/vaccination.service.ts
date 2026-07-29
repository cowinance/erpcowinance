import { Injectable } from '@nestjs/common';
import { assertNotBeforeBirth, assertTreatable } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { HealthApplicationLookupError } from './treatment.service';

/**
 * Núcleo NEUTRAL de vacunaciones (Sanidad E1). Regla y escritura ÚNICAS de la
 * aplicación de una vacuna, reutilizadas por REST/web y por el sync entrante — mismo
 * patrón que `TreatmentService`/`MortalityService`.
 *
 * La vacunación es una INTENCIÓN ATÓMICA: en una sola tx produce (1) UNA fila
 * `vaccinations` (con próximo refuerzo, lote del frasco y plan opcional) y (2) UN evento
 * `vaccination` de timeline en `animal_events` (llega por ambos canales — sync ya no queda
 * sin línea de tiempo). Idempotente por `vaccinationId` (= id de la fila; `op.rowId` en sync).
 *
 * Validaciones: animal del tenant y ACTIVO (`assertTreatable`), producto del tenant de tipo
 * vaccine. Rechazos SIN persistencia parcial.
 */

export type VaccinationOrigin = 'rest' | 'sync';

export interface RecordVaccinationInput {
  animalId: string;
  productId: string;
  appliedAt?: string;
  dose?: number | null;
  doseUnit?: string | null;
  batchNumber?: string | null;
  nextDueDate?: string | null;
  planId?: string | null;
  actorUserId: string;
  origin: VaccinationOrigin;
  /** Clave de idempotencia = id de la fila `vaccinations`. */
  vaccinationId: string;
  /** Nombre del producto, si el canal ya lo resolvió (evita relookup en lotes grandes). */
  productName?: string | null;
}

export interface RecordVaccinationResult {
  recorded: boolean;
  alreadyRecorded: boolean;
  vaccinationId: string;
  animalId: string;
  appliedAt: string;
  nextDueDate: string | null;
  tag: string | null;
}

@Injectable()
export class VaccinationService {
  constructor(private readonly db: DbService) {}

  async recordVaccination(q: Q, input: RecordVaccinationInput): Promise<RecordVaccinationResult> {
    const t = this.db.tenant;

    const existing = await q.one<{ id: string; applied_at: string; next_due_date: string | null }>(
      `SELECT id, applied_at, next_due_date FROM vaccinations WHERE id = $1 AND tenant_id = $2`,
      [input.vaccinationId, t],
    );
    if (existing) {
      return {
        recorded: false, alreadyRecorded: true, vaccinationId: input.vaccinationId, animalId: input.animalId,
        appliedAt: existing.applied_at, nextDueDate: existing.next_due_date, tag: null,
      };
    }

    const animal = await this.requireAnimal(q, input.animalId);
    assertTreatable(animal.status, animal.tag);
    const productName = input.productName ?? (await this.requireVaccine(q, input.productId)).name;

    const appliedAt = new Date(input.appliedAt ?? Date.now()).toISOString();
    // Misma regla que en tratamientos: una vacuna anterior al nacimiento del animal es un error de
    // tipeo, y queda en el historial y en la cobertura sanitaria como si fuera un hecho.
    // `input.appliedAt` y no `appliedAt`: el de arriba ya pasó por `new Date()`, y una fecha pelada
    // convertida a instante se corre un día para atrás en América.
    assertNotBeforeBirth(await this.db.farmDateOf(input.appliedAt ?? new Date().toISOString(), q), animal.birth_date, 'La fecha de aplicación');

    await q.query(
      `INSERT INTO vaccinations (id, tenant_id, animal_id, product_id, applied_at, dose, dose_unit, batch_number,
                                 next_due_date, plan_id, applied_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [
        input.vaccinationId, t, input.animalId, input.productId, appliedAt, input.dose ?? null, input.doseUnit ?? null,
        input.batchNumber ?? null, input.nextDueDate ?? null, input.planId ?? null, input.actorUserId, input.actorUserId,
      ],
    );

    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,'vaccination',$3,$4,now(),'manual')`,
      [t, input.animalId, JSON.stringify({
        product: productName, dose: input.dose ?? null, batch: input.batchNumber ?? null,
        next_due: input.nextDueDate ?? null, plan_id: input.planId ?? null, origin: input.origin,
      }), appliedAt],
    );

    return {
      recorded: true, alreadyRecorded: false, vaccinationId: input.vaccinationId, animalId: input.animalId,
      appliedAt, nextDueDate: input.nextDueDate ?? null, tag: animal.tag,
    };
  }

  private async requireAnimal(q: Q, animalId: string) {
    const row = await q.one<{ id: string; status: string; tag: string | null; birth_date: string | null }>(
      // `birth_date::text` y no la columna pelada: PGlite devuelve las `date` como objetos Date, y
      // `String(new Date(...))` da «Sun Jun 01» — comparado como texto contra «2025-12-08» daría
      // cualquier cosa. Es la misma trampa que ya mordió en destete.
      `SELECT a.id, a.status, a.birth_date::text AS birth_date, ai.value AS tag
       FROM animals a
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [animalId, this.db.tenant],
    );
    if (!row) throw new HealthApplicationLookupError('animal.not_found', 'Animal no encontrado');
    return row;
  }

  private async requireVaccine(q: Q, id: string) {
    const p = await q.one<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM products_veterinary WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!p) throw new HealthApplicationLookupError('product.not_found', 'Producto veterinario no encontrado');
    if (p.type !== 'vaccine') throw new HealthApplicationLookupError('product.wrong_type', `El producto '${p.name}' no es una vacuna`);
    return p;
  }
}
