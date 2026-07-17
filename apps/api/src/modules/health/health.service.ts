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

  /**
   * Vacunación MASIVA por objetivo (todo el hato / lote / categoría / selección) — reusa la regla
   * única `VaccinationService` por animal, idempotente por (Idempotency-Key, animal). Robusta: un
   * animal no apto (muerto/vendido) se SALTEA con motivo, sin abortar la aplicación del resto (el
   * rechazo del dominio es un throw JS previo a cualquier SQL → la tx no se corrompe).
   */
  async vaccinateMass(body: any, idempotencyKey?: string) {
    if (!body?.product_id) throw new BadRequestException({ code: 'vaccination.missing_product', title: 'product_id es obligatorio' });
    await this.requireDiagnosisOrProductValid('vaccine', body.product_id);
    const appliedAt = body.applied_at ?? new Date().toISOString();
    const nextDue = body.next_due_days
      ? new Date(new Date(appliedAt).getTime() + Number(body.next_due_days) * 86400000).toISOString().slice(0, 10)
      : (body.next_due_date ?? null);
    const animals = await this.resolveTargetAnimals(body);
    const baseKey = idempotencyKey ?? randomUUID();

    return this.db.tx(async (q) => {
      const applied: any[] = [];
      const skipped: { animal_id: string; reason: string }[] = [];
      for (const animalId of animals) {
        try {
          const r = await this.vaccinations.recordVaccination(q, {
            animalId, productId: body.product_id, appliedAt, dose: body.dose ?? null, doseUnit: body.dose_unit ?? null,
            batchNumber: body.batch_number ?? null, nextDueDate: nextDue, planId: body.plan_id ?? null,
            actorUserId: this.db.user, origin: 'rest', vaccinationId: this.deriveId(baseKey, animalId),
          });
          applied.push(r);
        } catch (e) {
          skipped.push({ animal_id: animalId, reason: this.skipReason(e) });
        }
      }
      return this.massResult(animals.length, applied, skipped);
    });
  }

  /** Tratamiento MASIVO por objetivo — análogo a `vaccinateMass`, reusa `TreatmentService`. */
  async treatMass(body: any, idempotencyKey?: string) {
    if (!body?.product_id) throw new BadRequestException({ code: 'treatment.missing_product', title: 'product_id es obligatorio' });
    await this.requireDiagnosisOrProductValid(null, body.product_id);
    if (body.diagnosis_id) await this.requireDiagnosis(body.diagnosis_id);
    const animals = await this.resolveTargetAnimals(body);
    const baseKey = idempotencyKey ?? randomUUID();

    return this.db.tx(async (q) => {
      const applied: any[] = [];
      const skipped: { animal_id: string; reason: string }[] = [];
      for (const animalId of animals) {
        try {
          const r = await this.treatments.recordTreatment(q, {
            animalId, productId: body.product_id, appliedAt: body.applied_at, dose: body.dose ?? null,
            doseUnit: body.dose_unit ?? null, route: body.route ?? null, diagnosisId: body.diagnosis_id ?? null,
            cost: body.cost ?? null, notes: body.notes ?? null, actorUserId: this.db.user, origin: 'rest',
            treatmentId: this.deriveId(baseKey, animalId),
          });
          applied.push(r);
        } catch (e) {
          skipped.push({ animal_id: animalId, reason: this.skipReason(e) });
        }
      }
      return this.massResult(animals.length, applied, skipped);
    });
  }

  /**
   * Cobertura de vacunación agrupada por lote o categoría (opcional: de un producto específico).
   * Cabezas activas vs animales con al menos una vacunación (del producto, si se pide) en 12 meses.
   */
  async coverage(by: 'lot' | 'category' = 'lot', productId?: string) {
    const t = this.db.tenant;
    const args: unknown[] = [t];
    let prodFilter = '';
    if (productId) {
      args.push(productId);
      prodFilter = `AND v.product_id = $${args.length}`;
    }
    const groupSel = by === 'category'
      ? `c.id AS group_id, c.name AS group_name`
      : `l.id AS group_id, l.name AS group_name`;
    const groupJoin = by === 'category'
      ? `JOIN animal_categories c ON c.id = a.category_id`
      : `JOIN lots l ON l.id = a.current_lot_id AND l.deleted_at IS NULL`;
    const groupBy = by === 'category' ? `c.id, c.name` : `l.id, l.name`;
    return this.db.query(
      `SELECT ${groupSel},
              count(DISTINCT a.id)::int AS head,
              count(DISTINCT a.id) FILTER (WHERE v.animal_id IS NOT NULL)::int AS vaccinated,
              round(count(DISTINCT a.id) FILTER (WHERE v.animal_id IS NOT NULL)::numeric
                    / NULLIF(count(DISTINCT a.id), 0) * 100, 1)::float AS pct
       FROM animals a
       ${groupJoin}
       LEFT JOIN vaccinations v ON v.animal_id = a.id AND v.deleted_at IS NULL
             AND v.applied_at >= now() - interval '12 months' ${prodFilter}
       WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
       GROUP BY ${groupBy}
       ORDER BY pct ASC NULLS FIRST, head DESC`,
      args,
    );
  }

  /** Resuelve el objetivo (all/lot/category/selection) al conjunto de ids de animales a aplicar. */
  private async resolveTargetAnimals(body: any): Promise<string[]> {
    const scope = body?.scope ?? (body?.animal_ids ? 'selection' : 'all');
    if (scope === 'selection') {
      const ids: string[] = Array.isArray(body?.animal_ids) ? body.animal_ids : [];
      if (!ids.length) throw new BadRequestException({ code: 'mass.empty_selection', title: 'La selección de animales está vacía' });
      return ids;
    }
    const args: unknown[] = [this.db.tenant];
    const where = [`a.tenant_id = $1`, `a.status = 'active'`, `a.deleted_at IS NULL`];
    if (scope === 'lot') {
      if (!body?.lot_id) throw new BadRequestException({ code: 'mass.missing_lot', title: 'lot_id es obligatorio para el objetivo lote' });
      args.push(body.lot_id);
      where.push(`a.current_lot_id = $${args.length}`);
    } else if (scope === 'category') {
      if (!body?.category_code) throw new BadRequestException({ code: 'mass.missing_category', title: 'category_code es obligatorio para el objetivo categoría' });
      args.push(body.category_code);
      where.push(`c.code = $${args.length}`);
    } else if (scope !== 'all') {
      throw new BadRequestException({ code: 'mass.invalid_scope', title: `Objetivo inválido: ${scope}` });
    }
    const rows = await this.db.query<{ id: string }>(
      `SELECT a.id FROM animals a LEFT JOIN animal_categories c ON c.id = a.category_id WHERE ${where.join(' AND ')}`,
      args,
    );
    return rows.map((r) => r.id);
  }

  private massResult(resolved: number, applied: any[], skipped: { animal_id: string; reason: string }[]) {
    const newlyApplied = applied.filter((r) => r.recorded).length;
    const already = applied.filter((r) => r.alreadyRecorded).length;
    return { resolved, applied: newlyApplied, already, skipped: skipped.length, skipped_detail: skipped };
  }

  private skipReason(e: unknown): string {
    if (e instanceof HealthApplicationError || e instanceof HealthApplicationLookupError) return e.code;
    throw e; // errores inesperados (SQL, etc.) NO se tragan: abortan la aplicación
  }

  /** Valida que el producto exista y (si se pide) sea del tipo esperado — fail-fast a nivel request. */
  private async requireDiagnosisOrProductValid(expectedType: string | null, productId: string) {
    const p = await this.db.one<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM products_veterinary WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [productId, this.db.tenant],
    );
    if (!p) throw new NotFoundException({ code: 'product.not_found', title: 'Producto veterinario no encontrado' });
    if (expectedType && p.type !== expectedType)
      throw new BadRequestException({ code: 'product.wrong_type', title: `El producto '${p.name}' no es del tipo requerido (${expectedType})` });
    return p;
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
    const [coverage, inTreatment, withdrawals, mortality, upcoming, openCases, overdueVacc] = await Promise.all([
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
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM clinical_cases cc JOIN animals a ON a.id = cc.animal_id
         WHERE cc.tenant_id = $1 AND cc.deleted_at IS NULL AND cc.status IN ('open','in_treatment','observation')`,
        [t],
      ),
      this.db.one<any>(`SELECT count(DISTINCT v.animal_id)::int AS n FROM vaccinations v ${HealthService.OVERDUE_VACC_JOIN} WHERE ${HealthService.OVERDUE_VACC_WHERE}`, [t]),
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
      clinical_cases_open: openCases?.n ?? 0,
      vaccinations_overdue: overdueVacc?.n ?? 0,
    };
  }

  /**
   * Predicado de "vacuna vencida" (regla única, reusada por KPI/animales críticos/sanidad por lote):
   * una vacunación con `next_due_date` en el pasado para un animal activo, SIN una vacunación posterior
   * del mismo producto (que ya la habría renovado). Así no se cuenta como vencida una dosis ya repetida.
   */
  private static readonly OVERDUE_VACC_JOIN = `JOIN animals a ON a.id = v.animal_id AND a.status='active' AND a.deleted_at IS NULL`;
  private static readonly OVERDUE_VACC_WHERE = `v.tenant_id = $1 AND v.deleted_at IS NULL AND v.next_due_date < CURRENT_DATE
     AND NOT EXISTS (SELECT 1 FROM vaccinations v2 WHERE v2.animal_id = v.animal_id AND v2.product_id = v.product_id
                     AND v2.deleted_at IS NULL AND v2.applied_at > v.applied_at)`;

  /**
   * Animales críticos: los que requieren atención sanitaria por al menos un motivo — caso clínico
   * abierto, retiro activo (carne/leche) o vacuna vencida. Un renglón por animal con sus motivos y un
   * puntaje para ordenar los más urgentes primero.
   */
  async criticalAnimals(limit = 50) {
    const t = this.db.tenant;
    return this.db.query(
      `WITH open_case AS (
         SELECT cc.animal_id, cc.severity, d.name AS diagnosis
         FROM clinical_cases cc LEFT JOIN diagnoses d ON d.id = cc.diagnosis_id
         WHERE cc.tenant_id = $1 AND cc.deleted_at IS NULL AND cc.status IN ('open','in_treatment','observation')
       ),
       wd AS (
         SELECT DISTINCT tr.animal_id FROM treatments tr
         WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL
           AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now())
       ),
       ov AS (SELECT DISTINCT v.animal_id FROM vaccinations v ${HealthService.OVERDUE_VACC_JOIN} WHERE ${HealthService.OVERDUE_VACC_WHERE})
       SELECT a.id AS animal_id, ai.value AS tag, c.name AS category, l.name AS lot_name,
              (oc.animal_id IS NOT NULL) AS has_open_case, oc.severity AS case_severity, oc.diagnosis,
              (wd.animal_id IS NOT NULL) AS has_withdrawal,
              (ov.animal_id IS NOT NULL) AS has_overdue_vaccination,
              (CASE WHEN oc.animal_id IS NOT NULL THEN (CASE oc.severity WHEN 'severe' THEN 5 WHEN 'moderate' THEN 3 ELSE 2 END) ELSE 0 END
               + CASE WHEN wd.animal_id IS NOT NULL THEN 2 ELSE 0 END
               + CASE WHEN ov.animal_id IS NOT NULL THEN 1 ELSE 0 END)::int AS score
       FROM animals a
       LEFT JOIN open_case oc ON oc.animal_id = a.id
       LEFT JOIN wd ON wd.animal_id = a.id
       LEFT JOIN ov ON ov.animal_id = a.id
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
         AND (oc.animal_id IS NOT NULL OR wd.animal_id IS NOT NULL OR ov.animal_id IS NOT NULL)
       ORDER BY score DESC, tag LIMIT $2`,
      [t, limit],
    );
  }

  /**
   * Sanidad por lote: qué lotes concentran más problemas sanitarios. Agrega por lote los casos
   * abiertos, animales en tratamiento (30 d), retiros activos, vacunas vencidas y muertes (90 d),
   * con un puntaje de problema para rankear los lotes más comprometidos.
   */
  async lotHealth() {
    const t = this.db.tenant;
    return this.db.query(
      `SELECT l.id AS lot_id, l.name AS lot_name, l.purpose,
              count(DISTINCT a.id)::int AS head,
              count(DISTINCT oc.id)::int AS open_cases,
              count(DISTINCT tr.animal_id) FILTER (WHERE tr.applied_at >= now() - interval '30 days')::int AS in_treatment,
              count(DISTINCT wd.animal_id)::int AS active_withdrawals,
              count(DISTINCT ov.animal_id)::int AS overdue_vaccinations,
              (SELECT count(*)::int FROM mortalities m JOIN animals ma ON ma.id = m.animal_id
                WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.died_at >= now() - interval '90 days'
                  AND ma.current_lot_id = l.id) AS deaths_90d,
              (count(DISTINCT oc.id) * 3 + count(DISTINCT wd.animal_id) + count(DISTINCT ov.animal_id))::int AS problem_score
       FROM lots l
       JOIN animals a ON a.current_lot_id = l.id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN clinical_cases oc ON oc.animal_id = a.id AND oc.deleted_at IS NULL AND oc.status IN ('open','in_treatment','observation')
       LEFT JOIN treatments tr ON tr.animal_id = a.id AND tr.deleted_at IS NULL
       LEFT JOIN treatments wd ON wd.animal_id = a.id AND wd.deleted_at IS NULL
             AND (wd.meat_withdrawal_until >= CURRENT_DATE OR wd.milk_withdrawal_until >= now())
       LEFT JOIN vaccinations ov ON ov.animal_id = a.id AND ov.deleted_at IS NULL AND ov.next_due_date < CURRENT_DATE
             AND NOT EXISTS (SELECT 1 FROM vaccinations v2 WHERE v2.animal_id = ov.animal_id AND v2.product_id = ov.product_id
                             AND v2.deleted_at IS NULL AND v2.applied_at > ov.applied_at)
       WHERE l.tenant_id = $1 AND l.deleted_at IS NULL
       GROUP BY l.id, l.name, l.purpose
       ORDER BY problem_score DESC, head DESC`,
      [t],
    );
  }
}
