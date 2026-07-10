import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeWithdrawal } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';

@Injectable()
export class HealthService {
  constructor(private readonly db: DbService) {}

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

  /** Vacunación (individual o de lote). Calcula el próximo refuerzo. */
  async vaccinate(body: any) {
    const animalIds: string[] = body?.animal_ids ?? (body?.animal_id ? [body.animal_id] : []);
    if (!animalIds.length || !body?.product_id)
      throw new BadRequestException({ code: 'vaccination.missing_fields', title: 'animal_id(s) y product_id son obligatorios' });
    const product = await this.requireProduct(body.product_id, 'vaccine');
    const appliedAt = body.applied_at ?? new Date().toISOString();
    const nextDue = body.next_due_days
      ? new Date(new Date(appliedAt).getTime() + Number(body.next_due_days) * 86400000).toISOString().slice(0, 10)
      : null;

    const results: Record<string, unknown>[] = [];
    for (const animalId of animalIds) {
      const animal = await requireAnimal(this.db, animalId);
      if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: `Animal ${animalId} no encontrado` });
      const row = await this.db.one<any>(
        `INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at, dose, dose_unit, batch_number, next_due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, applied_at, next_due_date`,
        [this.db.tenant, animalId, body.product_id, appliedAt, body.dose ?? null, body.dose_unit ?? null, body.batch_number ?? null, nextDue, this.db.user],
      );
      await insertAnimalEvent(this.db, animalId, 'vaccination', { product: product.name, dose: body.dose, batch: body.batch_number }, appliedAt);
      results.push({ animal_id: animalId, tag: animal.tag, ...row });
    }
    return { applied: results.length, results };
  }

  /** Tratamiento con cálculo automático de retiros según el producto. */
  async treat(body: any) {
    if (!body?.animal_id || !body?.product_id)
      throw new BadRequestException({ code: 'treatment.missing_fields', title: 'animal_id y product_id son obligatorios' });
    const animal = await requireAnimal(this.db, body.animal_id);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    const product = await this.requireProduct(body.product_id);
    const appliedAt = new Date(body.applied_at ?? Date.now());

    const { meatWithdrawalUntil: meatUntil, milkWithdrawalUntil: milkUntil } = computeWithdrawal(
      appliedAt,
      product.withdrawal_meat_days,
      product.withdrawal_milk_hours,
    );

    const row = await this.db.one<any>(
      `INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, dose, dose_unit, route, meat_withdrawal_until, milk_withdrawal_until, notes, cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, applied_at, meat_withdrawal_until, milk_withdrawal_until`,
      [this.db.tenant, body.animal_id, body.product_id, appliedAt.toISOString(), body.dose ?? null, body.dose_unit ?? null, body.route ?? null, meatUntil, milkUntil, body.notes ?? null, body.cost ?? null, this.db.user],
    );
    await insertAnimalEvent(
      this.db,
      body.animal_id,
      'treatment',
      { product: product.name, dose: body.dose, withdrawal_meat_until: meatUntil, withdrawal_milk_until: milkUntil },
      appliedAt.toISOString(),
    );
    return { ...row, tag: animal.tag, product: product.name };
  }

  /** Diagnóstico / evento clínico. */
  async healthEvent(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'health_event.missing_fields', title: 'animal_id es obligatorio' });
    const animal = await requireAnimal(this.db, body.animal_id);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    const occurredAt = body.occurred_at ?? new Date().toISOString();
    const row = await this.db.one<any>(
      `INSERT INTO health_events (tenant_id, animal_id, occurred_at, severity, outcome, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, occurred_at, severity, outcome`,
      [this.db.tenant, body.animal_id, occurredAt, body.severity ?? null, body.outcome ?? 'ongoing', body.notes ?? null, this.db.user],
    );
    await insertAnimalEvent(this.db, body.animal_id, 'diagnosis', { severity: body.severity, outcome: body.outcome, notes: body.notes }, occurredAt);
    return { ...row, tag: animal.tag };
  }

  /** Mortalidad: registra la muerte y da de baja al animal (cambio de estado por evento). */
  async mortality(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'mortality.missing_fields', title: 'animal_id es obligatorio' });
    const animal = await requireAnimal(this.db, body.animal_id);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (animal.status === 'dead')
      throw new BadRequestException({ code: 'mortality.already_dead', title: `El animal ${animal.tag} ya está registrado como muerto` });
    const diedAt = body.died_at ?? new Date().toISOString();

    const row = await this.db.one<any>(
      `INSERT INTO mortalities (tenant_id, animal_id, died_at, necropsy, estimated_loss, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, died_at`,
      [this.db.tenant, body.animal_id, diedAt, body.necropsy ?? false, body.estimated_loss ?? null, body.notes ?? null, this.db.user],
    );
    await this.db.query(`UPDATE animals SET status = 'dead', status_changed_at = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      body.animal_id,
      this.db.tenant,
      diedAt,
    ]);
    await insertAnimalEvent(this.db, body.animal_id, 'death', { cause: body.notes ?? null }, diedAt);
    return { ...row, tag: animal.tag };
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

  private async requireProduct(id: string, expectedType?: string) {
    const p = await this.db.one<any>(
      `SELECT id, name, type, withdrawal_meat_days, withdrawal_milk_hours FROM products_veterinary
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!p) throw new NotFoundException({ code: 'product.not_found', title: 'Producto veterinario no encontrado' });
    if (expectedType && p.type !== expectedType && expectedType === 'vaccine' && p.type !== 'vaccine')
      throw new BadRequestException({ code: 'product.wrong_type', title: `El producto '${p.name}' no es una vacuna` });
    return p;
  }
}
