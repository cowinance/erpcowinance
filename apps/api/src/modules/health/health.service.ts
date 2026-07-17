import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { HealthApplicationError } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';
import { MortalityService } from './mortality.service';
import { TreatmentService, HealthApplicationLookupError } from './treatment.service';
import { VaccinationService } from './vaccination.service';
import type { RecordVaccinationResult } from './vaccination.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly db: DbService,
    private readonly mortalities: MortalityService,
    private readonly treatments: TreatmentService,
    private readonly vaccinations: VaccinationService,
  ) {}

  /** Traduce los errores de dominio/lookup de los núcleos neutrales a HTTP. */
  private mapHealthError(e: unknown): never {
    if (e instanceof HealthApplicationError) throw new ConflictException({ code: e.code, title: e.reason });
    if (e instanceof HealthApplicationLookupError) {
      if (e.code === 'product.wrong_type') throw new BadRequestException({ code: e.code, title: e.reason });
      throw new NotFoundException({ code: e.code, title: e.reason });
    }
    throw e;
  }

  async products() {
    return this.db.query(
      `SELECT id, name, type, active_ingredient, withdrawal_meat_days, withdrawal_milk_hours, default_dose
       FROM products_veterinary WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [this.db.tenant],
    );
  }

  async createProduct(body: any) {
    if (!body?.name || !body?.type)
      throw new BadRequestException({ code: 'product.missing_fields', title: 'name y type son obligatorios' });
    return this.db.one(
      `INSERT INTO products_veterinary (tenant_id, name, type, active_ingredient, withdrawal_meat_days, withdrawal_milk_hours, default_dose, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [this.db.tenant, body.name, body.type, body.active_ingredient ?? null, body.withdrawal_meat_days ?? null, body.withdrawal_milk_hours ?? null, body.default_dose ?? null, this.db.user],
    );
  }

  /**
   * Vacunación (individual o de lote) — adaptador REST sobre la regla única
   * `VaccinationService`. Cada animal es UNA operación idempotente por su propio id
   * (derivado del `Idempotency-Key` de la request); reintentar la request no duplica.
   */
  async vaccinate(body: any, idempotencyKey?: string) {
    const animalIds: string[] = body?.animal_ids ?? (body?.animal_id ? [body.animal_id] : []);
    if (!animalIds.length || !body?.product_id)
      throw new BadRequestException({ code: 'vaccination.missing_fields', title: 'animal_id(s) y product_id son obligatorios' });
    const appliedAt = body.applied_at ?? new Date().toISOString();
    const nextDue = body.next_due_days
      ? new Date(new Date(appliedAt).getTime() + Number(body.next_due_days) * 86400000).toISOString().slice(0, 10)
      : (body.next_due_date ?? null);
    const baseKey = idempotencyKey ?? randomUUID();

    try {
      return await this.db.tx(async (q) => {
        const results: RecordVaccinationResult[] = [];
        for (const animalId of animalIds) {
          // id determinista por (key, animal): la misma request reaplicada no duplica ninguna fila.
          const vaccinationId = this.deriveId(baseKey, animalId);
          results.push(await this.vaccinations.recordVaccination(q, {
            animalId, productId: body.product_id, appliedAt, dose: body.dose ?? null, doseUnit: body.dose_unit ?? null,
            batchNumber: body.batch_number ?? null, nextDueDate: nextDue, planId: body.plan_id ?? null,
            actorUserId: this.db.user, origin: 'rest', vaccinationId,
          }));
        }
        return { applied: results.length, results };
      });
    } catch (e) {
      this.mapHealthError(e);
    }
  }

  /**
   * Tratamiento — adaptador REST sobre la regla única `TreatmentService` (retiro derivado
   * por dominio, timeline, evento de dominio, idempotente por id). Valida animal activo.
   */
  async treat(body: any, idempotencyKey?: string) {
    if (!body?.animal_id || !body?.product_id)
      throw new BadRequestException({ code: 'treatment.missing_fields', title: 'animal_id y product_id son obligatorios' });
    try {
      return await this.db.tx((q) =>
        this.treatments.recordTreatment(q, {
          animalId: body.animal_id, productId: body.product_id, appliedAt: body.applied_at, dose: body.dose ?? null,
          doseUnit: body.dose_unit ?? null, route: body.route ?? null, diagnosisId: body.diagnosis_id ?? null,
          clinicalCaseId: body.clinical_case_id ?? null, cost: body.cost ?? null, notes: body.notes ?? null,
          actorUserId: this.db.user, origin: 'rest', treatmentId: idempotencyKey ?? randomUUID(),
        }),
      );
    } catch (e) {
      this.mapHealthError(e);
    }
  }

  /** id determinista uuid v5-like a partir de (key, animal), sin dependencias externas. */
  private deriveId(baseKey: string, animalId: string): string {
    const h = createHash('sha1').update(`${baseKey}:${animalId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** Diagnóstico / evento clínico — con diagnóstico estructurado del catálogo y caso opcional. */
  async healthEvent(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'health_event.missing_fields', title: 'animal_id es obligatorio' });
    const animal = await requireAnimal(this.db, body.animal_id);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (body.diagnosis_id) await this.requireDiagnosis(body.diagnosis_id);
    const occurredAt = body.occurred_at ?? new Date().toISOString();
    const row = await this.db.one<any>(
      `INSERT INTO health_events (tenant_id, animal_id, diagnosis_id, clinical_case_id, occurred_at, severity, outcome, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, occurred_at, severity, outcome, diagnosis_id`,
      [this.db.tenant, body.animal_id, body.diagnosis_id ?? null, body.clinical_case_id ?? null, occurredAt, body.severity ?? null, body.outcome ?? 'ongoing', body.notes ?? null, this.db.user],
    );
    await insertAnimalEvent(this.db, body.animal_id, 'diagnosis', { diagnosis_id: body.diagnosis_id ?? null, severity: body.severity, outcome: body.outcome, notes: body.notes }, occurredAt);
    return { ...row, tag: animal.tag };
  }

  /**
   * Mortalidad — adaptador REST delgado sobre la operación neutral `MortalityService`
   * (P5-1.a). Conserva el contrato observable (`{ id, died_at, tag }`) más las mejoras
   * deliberadas de atomicidad (una sola tx), versión LWW de `status` y propagación al
   * móvil (server-origin). La regla vive UNA sola vez en `MortalityService`.
   */
  async mortality(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'mortality.missing_fields', title: 'animal_id es obligatorio' });
    if (body.cause_diagnosis_id) await this.requireDiagnosis(body.cause_diagnosis_id);
    const res = await this.db.tx((q) =>
      this.mortalities.recordMortality(q, {
        animalId: body.animal_id,
        diedAt: body.died_at,
        necropsy: body.necropsy ?? false,
        estimatedLoss: body.estimated_loss ?? null,
        causeDiagnosisId: body.cause_diagnosis_id ?? null,
        notes: body.notes ?? null,
        actorUserId: this.db.user,
        origin: 'rest',
        mortalityId: randomUUID(),
        emitServerOrigin: true,
      }),
    );
    return { id: res.mortalityId, died_at: res.diedAt, tag: res.tag };
  }

  /** Valida que el diagnóstico pertenezca al catálogo (global o del tenant). */
  private async requireDiagnosis(id: string) {
    const d = await this.db.one<{ id: string }>(
      `SELECT id FROM diagnoses WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2) AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!d) throw new BadRequestException({ code: 'diagnosis.invalid', title: 'Diagnóstico inválido' });
    return d;
  }

  async withdrawals() {
    return this.db.query(
      `SELECT tr.id, tr.animal_id, ai.value AS tag, pv.name AS product, tr.applied_at,
              tr.meat_withdrawal_until, tr.milk_withdrawal_until,
              GREATEST(0, (tr.meat_withdrawal_until - CURRENT_DATE))::int AS days_left
       FROM treatments tr
       JOIN animals a ON a.id = tr.animal_id AND a.status = 'active'
       LEFT JOIN products_veterinary pv ON pv.id = tr.product_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL
         AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now())
       ORDER BY tr.meat_withdrawal_until`,
      [this.db.tenant],
    );
  }

  async upcomingVaccinations(days = 45) {
    return this.db.query(
      `SELECT v.id, v.animal_id, ai.value AS tag, pv.name AS product, v.next_due_date,
              (v.next_due_date - CURRENT_DATE)::int AS days_until
       FROM vaccinations v
       JOIN animals a ON a.id = v.animal_id AND a.status = 'active'
       LEFT JOIN products_veterinary pv ON pv.id = v.product_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
         AND v.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int
       ORDER BY v.next_due_date LIMIT 50`,
      [this.db.tenant, days],
    );
  }

  async kpis() {
    const t = this.db.tenant;
    const [coverage, inTreatment, withdrawals, mortality, upcoming] = await Promise.all([
      this.db.one<any>(
        `SELECT
           (SELECT count(DISTINCT v.animal_id) FROM vaccinations v
             JOIN animals a ON a.id = v.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
             WHERE v.tenant_id = $1 AND v.applied_at >= now() - interval '12 months')::float
           / NULLIF((SELECT count(*) FROM animals WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL), 0) * 100 AS pct`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(DISTINCT animal_id)::int AS n FROM treatments
         WHERE tenant_id = $1 AND applied_at >= now() - interval '30 days' AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM treatments tr JOIN animals a ON a.id = tr.animal_id AND a.status='active'
         WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL
           AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now())`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS deaths,
                (SELECT count(*)::int FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('active','dead')) AS herd
         FROM mortalities WHERE tenant_id = $1 AND died_at >= now() - interval '12 months' AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM vaccinations v JOIN animals a ON a.id = v.animal_id AND a.status='active'
         WHERE v.tenant_id = $1 AND v.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 45 AND v.deleted_at IS NULL`,
        [t],
      ),
    ]);
    return {
      vaccination_coverage_pct: coverage?.pct != null ? +Number(coverage.pct).toFixed(1) : null,
      animals_in_treatment_30d: inTreatment?.n ?? 0,
      active_withdrawals: withdrawals?.n ?? 0,
      mortality_12m: {
        deaths: mortality?.deaths ?? 0,
        rate_pct: mortality?.herd ? +(((mortality.deaths ?? 0) / mortality.herd) * 100).toFixed(1) : null,
      },
      vaccinations_due_45d: upcoming?.n ?? 0,
    };
  }
}
