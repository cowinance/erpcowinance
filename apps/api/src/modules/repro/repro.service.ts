import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis, newbornCategoryCode } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';
import { WeaningService } from './weaning.service';

@Injectable()
export class ReproService {
  constructor(
    private readonly db: DbService,
    private readonly weanings: WeaningService,
  ) {}

  /** Detección de celo. */
  async heat(animalId: string, body: any) {
    const animal = await this.requireFemale(animalId);
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, notes, created_by)
       VALUES ($1,$2,'heat',$3,$4,$5) RETURNING id, occurred_at`,
      [this.db.tenant, animalId, occurredAt, body?.notes ?? null, this.db.user],
    );
    await insertAnimalEvent(this.db, animalId, 'heat', { notes: body?.notes ?? null }, occurredAt);
    return { ...row, tag: animal.tag };
  }

  /** Servicio: monta natural o inseminación artificial. */
  async service(animalId: string, body: any) {
    const animal = await this.requireFemale(animalId);
    const method = body?.method === 'natural' ? 'service_natural' : body?.method === 'ai' ? 'service_ai' : null;
    if (!method)
      throw new BadRequestException({ code: 'service.invalid_method', title: "method debe ser 'natural' o 'ai'" });
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, type, occurred_at`,
      [this.db.tenant, animalId, method, occurredAt, body?.sire_id ?? null, body?.notes ?? null, this.db.user],
    );
    await insertAnimalEvent(
      this.db,
      animalId,
      'service',
      { method: body.method, sire_id: body?.sire_id ?? null, expected_due: computeExpectedDueDateFromService(new Date(occurredAt)) },
      occurredAt,
    );
    return { ...row, tag: animal.tag };
  }

  /** Diagnóstico de gestación (ecografía/palpación). */
  async diagnose(body: any) {
    if (!body?.animal_id || !body?.result)
      throw new BadRequestException({ code: 'diagnosis.missing_fields', title: 'animal_id y result (pregnant|empty) son obligatorios' });
    const animal = await this.requireFemale(body.animal_id);
    const diagnosisDate = (body.diagnosis_date ?? new Date().toISOString()).slice(0, 10);

    if (body.result === 'pregnant') {
      const open = await this.db.one<any>(
        `SELECT id FROM pregnancies WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL`,
        [body.animal_id],
      );
      if (open)
        throw new BadRequestException({ code: 'diagnosis.already_pregnant', title: `${animal.tag} ya tiene una preñez abierta` });

      const lastService = await this.db.one<any>(
        `SELECT id, occurred_at FROM breeding_events
         WHERE animal_id = $1 AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL
           AND occurred_at <= $2::date + 1
         ORDER BY occurred_at DESC LIMIT 1`,
        [body.animal_id, diagnosisDate],
      );
      const expectedDue = lastService
        ? computeExpectedDueDateFromService(new Date(lastService.occurred_at))
        : computeExpectedDueDateFromDiagnosis(new Date(diagnosisDate));

      const row = await this.db.one<any>(
        `INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7) RETURNING id, diagnosis_date, expected_due_date`,
        [this.db.tenant, body.animal_id, lastService?.id ?? null, diagnosisDate, body.method ?? 'ultrasound', expectedDue, this.db.user],
      );
      await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_diagnosed', { method: body.method ?? 'ultrasound', expected_due_date: expectedDue }, diagnosisDate);
      return { ...row, tag: animal.tag, result: 'pregnant' };
    }

    // Vacía: si había preñez abierta, se marca perdida (aborto/reabsorción)
    const open = await this.db.one<any>(
      `UPDATE pregnancies SET status = 'lost', closed_at = $3, updated_at = now()
       WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL AND tenant_id = $2 RETURNING id`,
      [body.animal_id, this.db.tenant, diagnosisDate],
    );
    await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_negative', { method: body.method ?? 'ultrasound', previous_lost: !!open }, diagnosisDate);
    return { tag: animal.tag, result: 'empty', previous_pregnancy_lost: !!open };
  }

  /** Parto: cierra la preñez, registra el parto y da de alta las crías. */
  async calving(body: any) {
    if (!body?.dam_id)
      throw new BadRequestException({ code: 'calving.missing_fields', title: 'dam_id es obligatorio' });
    const dam = await this.requireFemale(body.dam_id);
    const calvingDate = (body.calving_date ?? new Date().toISOString()).slice(0, 10);
    const offspring: any[] = Array.isArray(body.offspring) && body.offspring.length ? body.offspring : [{ sex: 'F', vitality: 'live' }];

    const pregnancy = await this.db.one<any>(
      `UPDATE pregnancies SET status = 'calved', closed_at = $3, updated_at = now()
       WHERE animal_id = $1 AND tenant_id = $2 AND status = 'open' AND deleted_at IS NULL RETURNING id, breeding_event_id`,
      [body.dam_id, this.db.tenant, calvingDate],
    );
    const sire = pregnancy?.breeding_event_id
      ? await this.db.one<any>(`SELECT sire_id FROM breeding_events WHERE id = $1`, [pregnancy.breeding_event_id])
      : null;

    const calving = await this.db.one<any>(
      `INSERT INTO calvings (tenant_id, pregnancy_id, dam_id, calving_date, ease, offspring_count, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, calving_date`,
      [this.db.tenant, pregnancy?.id ?? null, body.dam_id, calvingDate, body.ease ?? null, offspring.length, body.notes ?? null, this.db.user],
    );

    const species = await this.db.one<any>(`SELECT id FROM species WHERE code = 'bovine'`);
    const calves: { animal_id: string | null; sex: string; vitality: string; tag: string | null }[] = [];
    for (const o of offspring) {
      let calfId: string | null = null;
      if (o.vitality !== 'stillborn') {
        const catCode = newbornCategoryCode(o.sex);
        const cat = await this.db.one<any>(`SELECT id FROM animal_categories WHERE code = $1`, [catCode]);
        const damRow = await this.db.one<any>(`SELECT farm_id, current_lot_id, current_paddock_id FROM animals WHERE id = $1`, [body.dam_id]);
        const calf = await this.db.one<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, birth_date, origin, dam_id, sire_id, breeding_method_origin, current_lot_id, current_paddock_id, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'born',$7,$8,$9,$10,$11,'active',$12) RETURNING id`,
          [this.db.tenant, damRow.farm_id, species.id, cat?.id ?? null, o.sex ?? 'F', calvingDate, body.dam_id, sire?.sire_id ?? null, 'natural', damRow.current_lot_id, damRow.current_paddock_id, this.db.user],
        );
        calfId = calf.id;
        if (o.tag) {
          await this.db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [
            this.db.tenant,
            calfId,
            String(o.tag),
          ]);
        }
        await insertAnimalEvent(this.db, calfId!, 'birth', { dam_tag: dam.tag, birth_weight_kg: o.birth_weight_kg ?? null }, calvingDate);
      }
      await this.db.query(
        `INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [this.db.tenant, calving.id, calfId, o.birth_weight_kg ?? null, o.vitality ?? 'live', this.db.user],
      );
      calves.push({ animal_id: calfId, sex: o.sex, vitality: o.vitality ?? 'live', tag: o.tag ?? null });
    }

    await insertAnimalEvent(this.db, body.dam_id, 'calving', { offspring: calves.length, ease: body.ease ?? null }, calvingDate);
    return { ...calving, dam_tag: dam.tag, offspring: calves };
  }

  /**
   * Destete — adaptador REST delgado sobre la operación neutral `WeaningService`
   * (P5-1.c). Conserva el contrato observable (`{ id, weaning_date, weaning_weight_kg,
   * tag }`) más la mejora deliberada de atomicidad (hecho + pesaje + timeline en una
   * sola tx) e idempotencia. La regla vive UNA sola vez en `WeaningService`.
   */
  async weaning(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'weaning.missing_fields', title: 'animal_id es obligatorio' });
    const res = await this.db.tx((q) =>
      this.weanings.recordWeaning(q, {
        animalId: body.animal_id,
        weaningDate: body.weaning_date,
        weightKg: body.weight_kg ?? null,
        weaningId: randomUUID(),
        actorUserId: this.db.user,
        origin: 'rest',
      }),
    );
    return { id: res.weaningId, weaning_date: res.weaningDate, weaning_weight_kg: res.weightKg, tag: res.tag };
  }

  /** Próximos partos (preñeces abiertas por fecha probable). */
  async upcomingCalvings(days = 60) {
    return this.db.query(
      `SELECT p.id, p.animal_id, ai.value AS tag, a.name, p.diagnosis_date, p.method, p.expected_due_date,
              (p.expected_due_date - CURRENT_DATE)::int AS days_until
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id AND a.status = 'active'
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.status = 'open' AND p.deleted_at IS NULL
         AND p.expected_due_date <= CURRENT_DATE + $2::int
       ORDER BY p.expected_due_date LIMIT 100`,
      [this.db.tenant, days],
    );
  }

  async pregnancies() {
    return this.db.query(
      `SELECT p.id, p.animal_id, ai.value AS tag, p.diagnosis_date, p.method, p.expected_due_date, p.status
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
       ORDER BY (p.status = 'open') DESC, p.expected_due_date LIMIT 200`,
      [this.db.tenant],
    );
  }

  async kpis() {
    const t = this.db.tenant;
    const [preg, services, calvings, weanings, dueSoon] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE p.status = 'open')::int AS open,
                (SELECT count(*)::int FROM animals a JOIN animal_categories c ON c.id = a.category_id
                 WHERE a.tenant_id = $1 AND a.status = 'active' AND c.code IN ('vaca','vaquillona') AND a.deleted_at IS NULL) AS females
         FROM pregnancies p WHERE p.tenant_id = $1 AND p.deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM breeding_events
         WHERE tenant_id = $1 AND type IN ('service_natural','service_ai') AND occurred_at >= now() - interval '90 days' AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM calvings WHERE tenant_id = $1 AND calving_date >= CURRENT_DATE - 365 AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n, avg(weaning_weight_kg)::float AS avg_kg FROM weanings
         WHERE tenant_id = $1 AND weaning_date >= CURRENT_DATE - 365 AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM pregnancies p JOIN animals a ON a.id = p.animal_id AND a.status = 'active'
         WHERE p.tenant_id = $1 AND p.status = 'open' AND p.expected_due_date <= CURRENT_DATE + 30 AND p.deleted_at IS NULL`,
        [t],
      ),
    ]);
    return {
      pregnancy_rate_pct: preg?.females ? +((preg.open / preg.females) * 100).toFixed(1) : null,
      open_pregnancies: preg?.open ?? 0,
      breeding_females: preg?.females ?? 0,
      services_90d: services?.n ?? 0,
      calvings_12m: calvings?.n ?? 0,
      weanings_12m: { n: weanings?.n ?? 0, avg_weight_kg: weanings?.avg_kg ? +weanings.avg_kg.toFixed(0) : null },
      calvings_due_30d: dueSoon?.n ?? 0,
    };
  }

  private async requireFemale(animalId: string) {
    const animal = await requireAnimal(this.db, animalId);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (animal.sex !== 'F')
      throw new BadRequestException({ code: 'repro.not_female', title: `${animal.tag} es macho: no admite eventos reproductivos de hembra` });
    return animal;
  }
}
