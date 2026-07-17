import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis, newbornCategoryCode, validateProtocolSteps, InvalidProtocolStepsError, computeReproStatus, DEFAULT_REPRO_CONFIG } from '@cowinance/domain';
import type { ReproConfig, ReproFacts } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';

@Injectable()
export class ReproService {
  constructor(
    private readonly db: DbService,
    private readonly weanings: WeaningService,
    private readonly tasks: TaskService,
    private readonly semen: SemenService,
    private readonly embryos: EmbryosService,
  ) {}

  /**
   * Guardas de servicio (integración Sanidad + Genética, E6): antes de registrar un servicio se valida
   * que el animal no tenga un RETIRO sanitario activo ni un CASO clínico grave abierto, y que el toro no
   * sea un pariente cercano de la vaca (consanguinidad). Cualquiera de estas condiciones BLOQUEA (409)
   * salvo `force=true`, en cuyo caso devuelve las advertencias que se saltearon. No re-implementa
   * sanidad: consulta directamente las tablas (treatments/clinical_cases), sin acoplar módulos.
   */
  private async serviceGuards(animalId: string, sireId: string | null, force: boolean): Promise<string[]> {
    const t = this.db.tenant;
    const warnings: string[] = [];
    const wd = await this.db.one<{ id: string }>(
      `SELECT id FROM treatments WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL
         AND (meat_withdrawal_until >= CURRENT_DATE OR milk_withdrawal_until >= now()) LIMIT 1`,
      [t, animalId],
    );
    if (wd) warnings.push('withdrawal_active');
    const sc = await this.db.one<{ id: string }>(
      `SELECT id FROM clinical_cases WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL
         AND status IN ('open','in_treatment','observation') AND severity='severe' LIMIT 1`,
      [t, animalId],
    );
    if (sc) warnings.push('open_severe_case');
    if (sireId) {
      // Consanguinidad: mismo padre/madre, o padre/hijo directo entre toro y vaca.
      const rel = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM animals dam, animals sire
         WHERE dam.id=$2 AND sire.id=$3 AND dam.tenant_id=$1
           AND ( sire.id = dam.sire_id                                  -- toro = padre de la vaca
              OR dam.id = sire.dam_id                                   -- vaca = madre del toro
              OR (dam.sire_id IS NOT NULL AND dam.sire_id = sire.sire_id) -- mismo padre
              OR (dam.dam_id  IS NOT NULL AND dam.dam_id  = sire.dam_id)  -- misma madre
              OR (sire.dam_id IS NOT NULL AND sire.dam_id = dam.id) )`,
        [t, animalId, sireId],
      );
      if ((rel?.n ?? 0) > 0) warnings.push('consanguinity');
    }
    if (warnings.length && !force)
      throw new ConflictException({ code: 'service.blocked', title: 'Servicio bloqueado', reasons: warnings });
    return warnings;
  }

  /**
   * Estado reproductivo AGREGADO por lote (E6): reusa `herdStatus` (regla única) y agrupa por lote —
   * cabezas, preñez %, listas para servicio, diagnóstico pendiente y abiertas. Rankea por «listas».
   */
  async reproByLot() {
    const herd = await this.herdStatus();
    const byLot = new Map<string, any>();
    for (const r of herd.rows) {
      const key = r.lot_id ?? 'none';
      if (!byLot.has(key)) byLot.set(key, { lot_id: r.lot_id, lot: r.lot ?? 'Sin lote', total: 0, pregnant: 0, due_soon: 0, ready_for_service: 0, diagnosis_pending: 0, open: 0 });
      const g = byLot.get(key);
      g.total++;
      if (r.status === 'pregnant' || r.status === 'due_soon') g.pregnant++;
      if (r.status === 'due_soon') g.due_soon++;
      if (r.status === 'ready_for_service') g.ready_for_service++;
      if (r.status === 'diagnosis_pending') g.diagnosis_pending++;
      if (r.status === 'open') g.open++;
    }
    const rows = [...byLot.values()]
      .map((g) => ({ ...g, pregnancy_rate_pct: g.total ? +((g.pregnant / g.total) * 100).toFixed(1) : null }))
      .sort((a, b) => b.ready_for_service - a.ready_for_service || b.total - a.total);
    return { rows };
  }

  /** id determinista uuid-like a partir de una clave de idempotencia + discriminante. */
  private deriveId(baseKey: string, discriminator: string): string {
    const h = createHash('sha1').update(`${baseKey}:${discriminator}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** Detección de celo — idempotente por Idempotency-Key. Registra intensidad y comportamiento. */
  async heat(animalId: string, body: any, idempotencyKey?: string) {
    const animal = await this.requireFemale(animalId);
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const id = idempotencyKey ? this.deriveId(idempotencyKey, animalId) : randomUUID();
    const payload = { intensity: body?.intensity ?? null, behavior: body?.behavior ?? null, notes: body?.notes ?? null };
    const existing = await this.db.one<any>(`SELECT id, occurred_at FROM breeding_events WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant]);
    if (existing) return { ...existing, tag: animal.tag, already: true };
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, notes, created_by)
       VALUES ($1,$2,$3,'heat',$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id, occurred_at`,
      [id, this.db.tenant, animalId, occurredAt, JSON.stringify(payload), this.db.user],
    );
    await insertAnimalEvent(this.db, animalId, 'heat', payload, occurredAt);
    return { ...row, tag: animal.tag };
  }

  /** Servicio: monta natural, inseminación artificial o transferencia embrionaria. Idempotente. */
  async service(animalId: string, body: any, idempotencyKey?: string) {
    const animal = await this.requireFemale(animalId);
    const method =
      body?.method === 'natural' ? 'service_natural' : body?.method === 'ai' ? 'service_ai' : body?.method === 'embryo_transfer' ? 'embryo_transfer' : null;
    if (!method)
      throw new BadRequestException({ code: 'service.invalid_method', title: "method debe ser 'natural', 'ai' o 'embryo_transfer'" });
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const id = idempotencyKey ? this.deriveId(idempotencyKey, animalId) : randomUUID();
    const existing = await this.db.one<any>(`SELECT id, type, occurred_at FROM breeding_events WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant]);
    if (existing) return { ...existing, tag: animal.tag, already: true };
    // Guardas (E6): retiro sanitario activo / caso clínico grave / consanguinidad. Bloquea salvo force.
    const warnings = await this.serviceGuards(animalId, body?.sire_id ?? null, body?.force === true);
    // Consumo de pajuela/embrión (G-2): solo en AI con partida o en transferencia con embrión. Se
    // descuenta ANTES de registrar el servicio (regla única del saldo); si no alcanza (403), no queda
    // ni el servicio ni el consumo (en una request comparten la misma tx). Móvil/sync aún no lo envía.
    const semenBatchId = method === 'service_ai' && body?.semen_batch_id ? body.semen_batch_id : null;
    const embryoId = method === 'embryo_transfer' && body?.embryo_id ? body.embryo_id : null;
    if (semenBatchId) await this.semen.adjustStraws(semenBatchId, -1, 'insemination');
    if (embryoId) await this.embryos.adjustStraws(embryoId, -1, 'transfer');
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, sire_id, semen_batch_id, embryo_id, technician_id, protocol_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING RETURNING id, type, occurred_at`,
      [id, this.db.tenant, animalId, method, occurredAt, body?.sire_id ?? null, semenBatchId, embryoId, body?.technician_id ?? null, body?.protocol_id ?? null, body?.notes ?? null, this.db.user],
    );
    await insertAnimalEvent(
      this.db,
      animalId,
      'service',
      { method: body.method, sire_id: body?.sire_id ?? null, expected_due: computeExpectedDueDateFromService(new Date(occurredAt)) },
      occurredAt,
    );
    return { ...row, tag: animal.tag, warnings };
  }

  /**
   * Servicio GRUPAL (monta natural de toro sobre un lote, o selección): aplica la regla única `service`
   * por vientre activo, idempotente por (Idempotency-Key, animal). Salta machos/no-vientres.
   */
  async bulkService(body: any, idempotencyKey?: string) {
    if (!body?.method) throw new BadRequestException({ code: 'service.missing_method', title: 'method es obligatorio' });
    let animalIds: string[] = Array.isArray(body?.animal_ids) ? body.animal_ids : [];
    if (!animalIds.length && body?.lot_id) {
      const rows = await this.db.query<{ id: string }>(
        `SELECT a.id FROM animals a JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca','vaquillona')
         WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL AND a.current_lot_id = $2`,
        [this.db.tenant, body.lot_id],
      );
      animalIds = rows.map((r) => r.id);
    }
    if (!animalIds.length) throw new BadRequestException({ code: 'service.no_targets', title: 'Indicá animal_ids o un lot_id con vientres' });
    const baseKey = idempotencyKey ?? randomUUID();
    const applied: string[] = [];
    const skipped: { animal_id: string; reason: string }[] = [];
    for (const animalId of animalIds) {
      try {
        await this.service(animalId, body, this.deriveId(baseKey, animalId));
        applied.push(animalId);
      } catch (e: any) {
        skipped.push({ animal_id: animalId, reason: e?.response?.code ?? 'error' });
      }
    }
    return { applied: applied.length, skipped: skipped.length, skipped_detail: skipped };
  }

  /** Celos detectados sin servicio posterior (para decidir a quién servir). */
  async heatsNotServed(days = 30) {
    return this.db.query(
      `SELECT h.animal_id, ai.value AS tag, l.name AS lot, max(h.occurred_at)::text AS last_heat
       FROM breeding_events h
       JOIN animals a ON a.id = h.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE h.tenant_id = $1 AND h.type = 'heat' AND h.deleted_at IS NULL
         AND h.occurred_at >= CURRENT_DATE - ($2 || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM breeding_events s WHERE s.animal_id = h.animal_id AND s.deleted_at IS NULL
                          AND s.type IN ('service_natural','service_ai','embryo_transfer') AND s.occurred_at >= h.occurred_at)
         AND NOT EXISTS (SELECT 1 FROM pregnancies p WHERE p.animal_id = h.animal_id AND p.status = 'open' AND p.deleted_at IS NULL)
       GROUP BY h.animal_id, ai.value, l.name
       ORDER BY last_heat DESC LIMIT 100`,
      [this.db.tenant, days],
    );
  }

  /** Diagnóstico de gestación (ecografía/palpación). */
  async diagnose(body: any, idempotencyKey?: string) {
    if (!body?.animal_id || !body?.result)
      throw new BadRequestException({ code: 'diagnosis.missing_fields', title: 'animal_id y result (pregnant|empty|doubtful) son obligatorios' });
    if (!['pregnant', 'empty', 'doubtful'].includes(body.result))
      throw new BadRequestException({ code: 'diagnosis.invalid_result', title: "result debe ser 'pregnant', 'empty' o 'doubtful'" });
    const animal = await this.requireFemale(body.animal_id);
    const diagnosisDate = (body.diagnosis_date ?? new Date().toISOString()).slice(0, 10);

    if (body.result === 'doubtful') {
      // Dudosa: no crea/cierra preñez; deja traza y agenda un RECONTROL (tarea) a los 14 días.
      return this.db.tx(async (q) => {
        await q.query(
          `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
           VALUES ($1,$2,'pregnancy_doubtful',$3,$4,now(),'manual')`,
          [this.db.tenant, body.animal_id, JSON.stringify({ method: body.method ?? 'ultrasound' }), diagnosisDate],
        );
        const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [this.db.tenant]))?.id ?? null;
        const due = new Date(new Date(diagnosisDate).getTime() + 14 * 86400000).toISOString();
        await this.tasks.createTask(q, { title: `Recontrol de diagnóstico — caravana ${animal.tag ?? '—'}`, type: 'breeding', dueDate: due, priority: 'normal', relatedType: 'animal', relatedId: body.animal_id, farmId: farm }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
        return { tag: animal.tag, result: 'doubtful', recheck_due: due.slice(0, 10) };
      });
    }

    if (body.result === 'pregnant') {
      const open = await this.db.one<any>(
        `SELECT id FROM pregnancies WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL`,
        [body.animal_id],
      );
      if (open)
        throw new BadRequestException({ code: 'diagnosis.already_pregnant', title: `${animal.tag} ya tiene una preñez abierta` });

      const pregnancyId = idempotencyKey ? this.deriveId(idempotencyKey, body.animal_id) : randomUUID();
      const dup = await this.db.one<any>(`SELECT id, diagnosis_date, expected_due_date FROM pregnancies WHERE id = $1 AND tenant_id = $2`, [pregnancyId, this.db.tenant]);
      if (dup) return { ...dup, tag: animal.tag, result: 'pregnant', already: true };

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
        `INSERT INTO pregnancies (id, tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8) ON CONFLICT (id) DO NOTHING RETURNING id, diagnosis_date, expected_due_date`,
        [pregnancyId, this.db.tenant, body.animal_id, lastService?.id ?? null, diagnosisDate, body.method ?? 'ultrasound', expectedDue, this.db.user],
      );
      await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_diagnosed', { method: body.method ?? 'ultrasound', expected_due_date: expectedDue }, diagnosisDate);
      return { ...row, tag: animal.tag, result: 'pregnant' };
    }

    // Vacía: si había preñez abierta, se marca perdida (reabsorción). Vuelve a estado abierta/elegible.
    const open = await this.db.one<any>(
      `UPDATE pregnancies SET status = 'lost', closed_at = $3, updated_at = now()
       WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL AND tenant_id = $2 RETURNING id`,
      [body.animal_id, this.db.tenant, diagnosisDate],
    );
    await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_negative', { method: body.method ?? 'ultrasound', previous_lost: !!open }, diagnosisDate);
    return { tag: animal.tag, result: 'empty', previous_pregnancy_lost: !!open };
  }

  /**
   * Aborto / pérdida reproductiva: cierra la preñez abierta como 'aborted' con causa y edad
   * gestacional aproximada, deja traza en timeline y agenda una TAREA de revisión sanitaria. Idempotente.
   */
  async abortion(body: any, idempotencyKey?: string) {
    if (!body?.animal_id) throw new BadRequestException({ code: 'abortion.missing_fields', title: 'animal_id es obligatorio' });
    const animal = await this.requireFemale(body.animal_id);
    const occurredAt = (body.occurred_at ?? new Date().toISOString()).slice(0, 10);
    return this.db.tx(async (q) => {
      const open = await q.one<any>(
        `UPDATE pregnancies SET status = 'aborted', closed_at = $3, loss_cause = $4, loss_gestational_days = $5, updated_at = now()
         WHERE animal_id = $1 AND tenant_id = $2 AND status = 'open' AND deleted_at IS NULL RETURNING id`,
        [body.animal_id, this.db.tenant, occurredAt, body.cause ?? null, body.gestational_age_days ?? null],
      );
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'abortion',$3,$4,now(),'manual')`,
        [this.db.tenant, body.animal_id, JSON.stringify({ cause: body.cause ?? null, gestational_age_days: body.gestational_age_days ?? null, had_open_pregnancy: !!open }), occurredAt],
      );
      const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [this.db.tenant]))?.id ?? null;
      await this.tasks.createTask(q, { title: `Revisión por aborto — caravana ${animal.tag ?? '—'}`, type: 'health', dueDate: new Date().toISOString(), priority: 'high', relatedType: 'animal', relatedId: body.animal_id, farmId: farm }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
      return { tag: animal.tag, result: 'aborted', pregnancy_closed: !!open, occurred_at: occurredAt };
    });
  }

  /** Parto: cierra la preñez, registra el parto, da de alta las crías y agenda tareas postparto. Idempotente. */
  async calving(body: any, idempotencyKey?: string) {
    if (!body?.dam_id)
      throw new BadRequestException({ code: 'calving.missing_fields', title: 'dam_id es obligatorio' });
    const dam = await this.requireFemale(body.dam_id);
    const calvingDate = (body.calving_date ?? new Date().toISOString()).slice(0, 10);
    const offspring: any[] = Array.isArray(body.offspring) && body.offspring.length ? body.offspring : [{ sex: 'F', vitality: 'live' }];
    const calvingId = idempotencyKey ? this.deriveId(idempotencyKey, body.dam_id) : randomUUID();
    const config = await this.reproConfig();

    return this.db.tx(async (q) => {
      const existing = await q.one<any>(`SELECT id, calving_date::text AS calving_date FROM calvings WHERE id = $1 AND tenant_id = $2`, [calvingId, this.db.tenant]);
      if (existing) return { ...existing, dam_tag: dam.tag, already: true };

      const pregnancy = await q.one<any>(
        `UPDATE pregnancies SET status = 'calved', closed_at = $3, updated_at = now()
         WHERE animal_id = $1 AND tenant_id = $2 AND status = 'open' AND deleted_at IS NULL RETURNING id, breeding_event_id`,
        [body.dam_id, this.db.tenant, calvingDate],
      );
      const sire = pregnancy?.breeding_event_id
        ? await q.one<any>(`SELECT sire_id FROM breeding_events WHERE id = $1`, [pregnancy.breeding_event_id])
        : null;

      const calving = await q.one<any>(
        `INSERT INTO calvings (id, tenant_id, pregnancy_id, dam_id, calving_date, ease, offspring_count, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING id, calving_date`,
        [calvingId, this.db.tenant, pregnancy?.id ?? null, body.dam_id, calvingDate, body.ease ?? null, offspring.length, body.notes ?? null, this.db.user],
      );

      const species = await q.one<any>(`SELECT id FROM species WHERE code = 'bovine'`);
      const damRow = await q.one<any>(`SELECT farm_id, current_lot_id, current_paddock_id FROM animals WHERE id = $1`, [body.dam_id]);
      const calves: { animal_id: string | null; sex: string; vitality: string; tag: string | null }[] = [];
      for (const o of offspring) {
        let calfId: string | null = null;
        if (o.vitality !== 'stillborn') {
          const cat = await q.one<any>(`SELECT id FROM animal_categories WHERE code = $1`, [newbornCategoryCode(o.sex)]);
          const calf = await q.one<any>(
            `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, birth_date, origin, dam_id, sire_id, breeding_method_origin, current_lot_id, current_paddock_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'born',$7,$8,$9,$10,$11,'active',$12) RETURNING id`,
            [this.db.tenant, damRow.farm_id, species.id, cat?.id ?? null, o.sex ?? 'F', calvingDate, body.dam_id, sire?.sire_id ?? null, 'natural', damRow.current_lot_id, damRow.current_paddock_id, this.db.user],
          );
          calfId = calf.id;
          if (o.tag) await q.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [this.db.tenant, calfId, String(o.tag)]);
          await q.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source) VALUES ($1,$2,'birth',$3,$4,now(),'manual')`, [this.db.tenant, calfId, JSON.stringify({ dam_tag: dam.tag, birth_weight_kg: o.birth_weight_kg ?? null }), calvingDate]);
        }
        await q.query(
          `INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [this.db.tenant, calving.id, calfId, o.birth_weight_kg ?? null, o.vitality ?? 'live', this.db.user],
        );
        calves.push({ animal_id: calfId, sex: o.sex, vitality: o.vitality ?? 'live', tag: o.tag ?? null });
      }

      await q.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source) VALUES ($1,$2,'calving',$3,$4,now(),'manual')`, [this.db.tenant, body.dam_id, JSON.stringify({ offspring: calves.length, ease: body.ease ?? null }), calvingDate]);

      // Tareas postparto (server-authored → sincronizan + agenda): revisión postparto (+30 d) y
      // preparación para nuevo servicio (al cumplir el VWP configurado).
      const reviewDue = new Date(new Date(calvingDate).getTime() + 30 * 86400000).toISOString();
      const prepDue = new Date(new Date(calvingDate).getTime() + config.vwpDays * 86400000).toISOString();
      await this.tasks.createTask(q, { title: `Revisión postparto — caravana ${dam.tag ?? '—'}`, type: 'breeding', dueDate: reviewDue, priority: 'normal', relatedType: 'animal', relatedId: body.dam_id, farmId: damRow.farm_id }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
      await this.tasks.createTask(q, { title: `Preparar para servicio — caravana ${dam.tag ?? '—'}`, type: 'breeding', dueDate: prepDue, priority: 'normal', relatedType: 'animal', relatedId: body.dam_id, farmId: damRow.farm_id }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });

      return { ...calving, dam_tag: dam.tag, offspring: calves };
    });
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

  /**
   * Dashboard reproductivo operativo (E3): «qué tengo que hacer» en una sola llamada. COMPONE los
   * métodos existentes (KPIs, estado del rodeo, próximas a preparar, partos próximos, protocolos
   * activos) — sin duplicar reglas. El estado (diagnóstico pendiente / abiertas críticas) se deriva
   * de la regla única `computeReproStatus` vía `herdStatus`.
   */
  async reproDashboard() {
    const [kpis, herd, prepare, calvings, assignments] = await Promise.all([
      this.kpis(),
      this.herdStatus(),
      this.toPrepare(14),
      this.upcomingCalvings(30),
      this.listAssignments(),
    ]);
    const diagnosisPending = herd.rows.filter((r) => r.status === 'diagnosis_pending')
      .sort((a, b) => (b.days_since_service ?? 0) - (a.days_since_service ?? 0)).slice(0, 50);
    const criticalOpen = herd.rows.filter((r) => r.status === 'open' || r.status === 'repeat_breeder')
      .sort((a, b) => (b.days_open ?? 0) - (a.days_open ?? 0)).slice(0, 50);
    const activeProtocols = (assignments as any[]).filter((a) => a.status === 'active');
    return {
      kpis,
      counts: herd.counts,
      config: herd.config,
      diagnosis_pending: diagnosisPending,
      critical_open: criticalOpen,
      upcoming_calvings: calvings,
      to_prepare: prepare.rows,
      active_protocols: activeProtocols,
    };
  }

  /**
   * Configuración reproductiva del rodeo: días voluntarios de espera y umbrales, leídos de las reglas
   * de alerta configurables (overrides por tenant) con fallback a `DEFAULT_REPRO_CONFIG` del dominio.
   */
  async reproConfig(): Promise<ReproConfig> {
    const rows = await this.db.query<{ code: string; days: number | null; is_active: boolean }>(
      `SELECT condition->>'code' AS code, (condition->>'days')::int AS days, is_active FROM alert_rules WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const by = new Map(rows.map((r) => [r.code, r]));
    const n = (code: string, fallback: number) => by.get(code)?.days ?? fallback;
    return {
      ...DEFAULT_REPRO_CONFIG,
      vwpDays: n('vwp_ready', DEFAULT_REPRO_CONFIG.vwpDays),
      diagnosisDueDays: n('diagnosis_due', DEFAULT_REPRO_CONFIG.diagnosisDueDays),
      openTooLongDays: n('open_too_long', DEFAULT_REPRO_CONFIG.openTooLongDays),
      repeatBreederServices: n('repeat_breeder', DEFAULT_REPRO_CONFIG.repeatBreederServices),
      calvingSoonDays: n('calving_soon', DEFAULT_REPRO_CONFIG.calvingSoonDays),
    };
  }

  /**
   * SQL de HECHOS reproductivos por vientre activo (vaca/vaquillona): preñez abierta, último parto,
   * último servicio, último diagnóstico negativo, último aborto, servicios desde el último parto y si
   * el lote está en un protocolo activo. Único lugar que arma los hechos que consume la regla pura
   * `computeReproStatus`. `extraFilter` acota (p. ej. por lote).
   */
  private reproFactsSql(extraFilter = ''): string {
    return `
      SELECT a.id AS animal_id, ai.value AS tag, a.name, a.current_lot_id AS lot_id, l.name AS lot,
             (c.code = 'vaquillona') AS is_heifer,
             p.expected_due_date::text AS expected_due_date,
             cal.last_calving::text AS last_calving, s.last_service::text AS last_service,
             neg.last_neg::text AS last_neg, ab.last_abortion::text AS last_abortion,
             COALESCE(scv.n, 0)::int AS services_since_calving,
             (prot.id IS NOT NULL) AS in_protocol
      FROM animals a
      JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca','vaquillona')
      LEFT JOIN lots l ON l.id = a.current_lot_id
      LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
      LEFT JOIN LATERAL (SELECT expected_due_date FROM pregnancies WHERE animal_id = a.id AND status='open' AND deleted_at IS NULL ORDER BY diagnosis_date DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT max(calving_date) AS last_calving FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL) cal ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_service FROM breeding_events WHERE animal_id = a.id AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL) s ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_neg FROM animal_events WHERE animal_id = a.id AND event_type = 'pregnancy_negative' AND deleted_at IS NULL) neg ON true
      LEFT JOIN LATERAL (SELECT max(closed_at) AS last_abortion FROM pregnancies WHERE animal_id = a.id AND status IN ('aborted','lost') AND deleted_at IS NULL) ab ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM breeding_events be WHERE be.animal_id = a.id AND be.type IN ('service_natural','service_ai','embryo_transfer') AND be.deleted_at IS NULL
                          AND be.occurred_at::date > COALESCE((SELECT max(calving_date) FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL), '1900-01-01'::date)) scv ON true
      LEFT JOIN LATERAL (SELECT pa.id FROM repro_protocol_assignments pa WHERE pa.lot_id = a.current_lot_id AND pa.tenant_id = a.tenant_id AND pa.status = 'active' AND pa.deleted_at IS NULL LIMIT 1) prot ON true
      WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL${extraFilter}`;
  }

  private factsOf(r: any): ReproFacts {
    return {
      isHeifer: !!r.is_heifer,
      culledReproductively: false,
      expectedDueDate: r.expected_due_date ? String(r.expected_due_date).slice(0, 10) : null,
      lastCalvingDate: r.last_calving ? String(r.last_calving).slice(0, 10) : null,
      lastServiceDate: r.last_service ? String(r.last_service).slice(0, 10) : null,
      lastPositiveDiagnosisDate: null,
      lastNegativeDiagnosisDate: r.last_neg ? String(r.last_neg).slice(0, 10) : null,
      lastAbortionDate: r.last_abortion ? String(r.last_abortion).slice(0, 10) : null,
      servicesSinceCalving: Number(r.services_since_calving ?? 0),
      inActiveProtocol: !!r.in_protocol,
    };
  }

  /**
   * Estado reproductivo del rodeo: cada vientre ACTIVO con su estado DERIVADO por la regla única
   * `computeReproStatus` desde eventos reales, más días postparto / abiertos / desde servicio. Snapshot.
   */
  async herdStatus(lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(`${this.reproFactsSql(lotFilter)} ORDER BY ai.value NULLS LAST`, params);
    const config = await this.reproConfig();
    const today = new Date().toISOString().slice(0, 10);

    const counts: Record<string, number> = { total: rows.length };
    const out = rows.map((r) => {
      const state = computeReproStatus(this.factsOf(r), config, today);
      counts[state.status] = (counts[state.status] ?? 0) + 1;
      return {
        animal_id: r.animal_id, tag: r.tag ?? null, name: r.name ?? null, lot: r.lot ?? null, lot_id: r.lot_id ?? null,
        status: state.status,
        days_postpartum: state.daysPostpartum, days_open: state.daysOpen, days_since_service: state.daysSinceService,
        expected_due_date: state.expectedDueDate, days_until: state.daysUntilDue,
        eligible_for_service: state.eligibleForService,
      };
    });
    return { lot_id: lotId ?? null, config, counts, rows: out };
  }

  /**
   * Próximas vacas a preparar para servicio: vientres en postparto cuyos días postparto alcanzarán el
   * VWP dentro de `withinDays` (aún no lo cumplen). Fuente única de hechos + regla pura.
   */
  async toPrepare(withinDays = 7) {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const today = new Date().toISOString().slice(0, 10);
    const out = rows
      .map((r) => ({ r, state: computeReproStatus(this.factsOf(r), config, today) }))
      .filter(({ state }) => state.daysPostpartum != null && state.expectedDueDate == null
        && state.daysPostpartum < config.vwpDays && config.vwpDays - state.daysPostpartum <= withinDays)
      .map(({ r, state }) => ({
        animal_id: r.animal_id, tag: r.tag ?? null, lot: r.lot ?? null,
        days_postpartum: state.daysPostpartum, days_to_vwp: config.vwpDays - (state.daysPostpartum ?? 0), status: state.status,
      }))
      .sort((a, b) => a.days_to_vwp - b.days_to_vwp);
    return { within_days: withinDays, vwp_days: config.vwpDays, count: out.length, rows: out };
  }

  private async ruleDays(code: string, fallback: number): Promise<number> {
    const r = await this.db.one<{ days: number | null }>(
      `SELECT (condition->>'days')::int AS days FROM alert_rules WHERE tenant_id=$1 AND condition->>'code'=$2 AND deleted_at IS NULL`,
      [this.db.tenant, code],
    );
    return r?.days ?? fallback;
  }

  /**
   * Alertas reproductivas DERIVADAS de la misma regla `computeReproStatus` (no re-implementa el estado
   * en SQL): diagnóstico pendiente / abierta demasiado tiempo / repetidora (por vientre) y agregadas de
   * «listas para servicio» (VWP cumplido) y «próximas a preparar». El motor de alertas filtra por regla
   * activa. Devuelve objetos con la forma `Desired` del módulo de alertas.
   */
  async statusAlerts(): Promise<any[]> {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const prepDays = await this.ruleDays('service_prep_due', 7);
    const today = new Date().toISOString().slice(0, 10);
    const out: any[] = [];
    let vwpReady = 0;
    let prepDue = 0;
    for (const r of rows) {
      const facts = this.factsOf(r);
      const st = computeReproStatus(facts, config, today);
      const tag = r.tag ?? '—';
      if (st.status === 'diagnosis_pending')
        out.push({ code: 'diagnosis_due', category: 'reproduction', severity: 'warning', title: `Diagnóstico pendiente — caravana ${tag}`, message: `Servicio sin diagnóstico hace ${st.daysSinceService} días`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'open')
        out.push({ code: 'open_too_long', category: 'reproduction', severity: 'warning', title: `Vaca abierta — caravana ${tag}`, message: `Abierta hace ${st.daysOpen} días (sin preñez)`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'repeat_breeder')
        out.push({ code: 'repeat_breeder', category: 'reproduction', severity: 'warning', title: `Repetidora — caravana ${tag}`, message: `${facts.servicesSinceCalving} servicios sin preñez`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      if (st.status === 'ready_for_service' && facts.lastCalvingDate) vwpReady++;
      if (st.daysPostpartum != null && st.expectedDueDate == null && st.daysPostpartum < config.vwpDays && config.vwpDays - st.daysPostpartum <= prepDays) prepDue++;
    }
    if (vwpReady > 0)
      out.push({ code: 'vwp_ready', category: 'reproduction', severity: 'info', title: `${vwpReady} vaca${vwpReady === 1 ? '' : 's'} lista${vwpReady === 1 ? '' : 's'} para servicio`, message: `Cumplieron el descanso postparto (${config.vwpDays} días)`, related_type: null, related_id: null, due_at: null, tag: null });
    if (prepDue > 0)
      out.push({ code: 'service_prep_due', category: 'reproduction', severity: 'info', title: `${prepDue} vaca${prepDue === 1 ? '' : 's'} estará${prepDue === 1 ? '' : 'n'} lista${prepDue === 1 ? '' : 's'} para servicio pronto`, message: `Se preparan para servicio en los próximos ${prepDays} días`, related_type: null, related_id: null, due_at: null, tag: null });
    return out;
  }

  // ── Protocolos reproductivos (IATF), plantillas (R-2.a) ──────────────────────
  /** Lista los protocolos del tenant (no eliminados); activos primero. */
  async listProtocols() {
    return this.db.query(
      `SELECT id, name, steps, is_active, created_at, updated_at FROM repro_protocols
       WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY is_active DESC, name`,
      [this.db.tenant],
    );
  }

  private steps(raw: unknown) {
    try {
      return validateProtocolSteps(raw);
    } catch (e) {
      throw new BadRequestException({ code: 'protocol.invalid_steps', title: e instanceof InvalidProtocolStepsError ? e.message : 'steps inválidos' });
    }
  }

  /** Crea una plantilla de protocolo. `species_id` = bovino del catálogo por defecto. */
  async createProtocol(body: any) {
    const name = (body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'protocol.missing_name', title: 'name es obligatorio' });
    const steps = this.steps(body?.steps ?? []);
    const species = await this.db.one<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`);
    if (!species) throw new BadRequestException({ code: 'protocol.no_species', title: 'Especie bovina no encontrada' });
    return this.db.one<any>(
      `INSERT INTO repro_protocols (tenant_id, name, species_id, steps, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, name, steps, is_active, created_at, updated_at`,
      [this.db.tenant, name, species.id, JSON.stringify(steps), this.db.user],
    );
  }

  /** Edita nombre / pasos / activación de una plantilla. */
  async updateProtocol(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) throw new BadRequestException({ code: 'protocol.missing_name', title: 'name no puede ser vacío' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body?.steps !== undefined) {
      params.push(JSON.stringify(this.steps(body.steps)));
      sets.push(`steps = $${params.length}::jsonb`);
    }
    if (typeof body?.is_active === 'boolean') {
      params.push(body.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length === 0) throw new BadRequestException({ code: 'protocol.no_changes', title: 'Nada para actualizar' });
    params.push(id);
    const idIdx = params.length;
    params.push(this.db.tenant);
    const tIdx = params.length;
    const row = await this.db.one<any>(
      `UPDATE repro_protocols SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${idIdx} AND tenant_id = $${tIdx} AND deleted_at IS NULL
       RETURNING id, name, steps, is_active, created_at, updated_at`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'protocol.not_found', title: 'Protocolo no encontrado' });
    return row;
  }

  /** Baja lógica (soft delete) de una plantilla. Los eventos históricos con protocol_id la conservan. */
  async deleteProtocol(id: string) {
    const row = await this.db.one<{ id: string }>(
      `UPDATE repro_protocols SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (!row) throw new NotFoundException({ code: 'protocol.not_found', title: 'Protocolo no encontrado' });
    return { id, deleted: true };
  }

  // ── Asignación de protocolos (R-2.b + E4: lote/categoría/selección/hato) ──────
  /** Resuelve los vientres objetivo (vaca/vaquillona activos) del target de un protocolo. */
  private async resolveProtocolTargets(body: any): Promise<{ targetType: string; label: string; ids: string[]; lotId: string | null; categoryCode: string | null }> {
    const t = this.db.tenant;
    const base = `FROM animals a JOIN animal_categories c ON c.id=a.category_id AND c.code IN ('vaca','vaquillona')
                  WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL`;
    if (Array.isArray(body?.animal_ids) && body.animal_ids.length) {
      const rows = await this.db.query<{ id: string }>(`SELECT a.id ${base} AND a.id = ANY($2)`, [t, body.animal_ids]);
      return { targetType: 'selection', label: `selección (${rows.length})`, ids: rows.map((r) => r.id), lotId: null, categoryCode: null };
    }
    if (body?.lot_id) {
      const lot = await this.db.one<{ id: string; name: string }>(`SELECT id, name FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.lot_id, t]);
      if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
      const rows = await this.db.query<{ id: string }>(`SELECT a.id ${base} AND a.current_lot_id=$2`, [t, lot.id]);
      return { targetType: 'lot', label: lot.name, ids: rows.map((r) => r.id), lotId: lot.id, categoryCode: null };
    }
    if (body?.category_code) {
      const rows = await this.db.query<{ id: string }>(`SELECT a.id ${base} AND c.code=$2`, [t, body.category_code]);
      return { targetType: 'category', label: `categoría ${body.category_code}`, ids: rows.map((r) => r.id), lotId: null, categoryCode: body.category_code };
    }
    const rows = await this.db.query<{ id: string }>(`SELECT a.id ${base}`, [t]);
    return { targetType: 'all', label: 'todo el hato', ids: rows.map((r) => r.id), lotId: null, categoryCode: null };
  }

  /**
   * Asigna un protocolo a lote / categoría / selección / todo el hato desde `start_date`. Snapshotea los
   * vientres objetivo (para progreso y eventos reales al completar pasos), genera UNA tarea por paso
   * (nivel grupo) vía TaskService. Evita duplicados: no reasigna el mismo protocolo a un animal que ya
   * está en una asignación ACTIVA. Atómico (db.tx).
   */
  async assignProtocol(body: any) {
    const startDate = String(body?.start_date ?? '').slice(0, 10);
    if (!body?.protocol_id || !startDate)
      throw new BadRequestException({ code: 'assignment.missing_fields', title: 'protocol_id y start_date son obligatorios' });
    if (Number.isNaN(new Date(`${startDate}T00:00:00.000Z`).getTime()))
      throw new BadRequestException({ code: 'assignment.invalid_date', title: `start_date inválida: ${startDate}` });
    const t = this.db.tenant;
    const protocol = await this.db.one<any>(`SELECT id, name, steps FROM repro_protocols WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.protocol_id, t]);
    if (!protocol) throw new NotFoundException({ code: 'protocol.not_found', title: 'Protocolo no encontrado' });

    const target = await this.resolveProtocolTargets(body);
    if (target.ids.length === 0) throw new BadRequestException({ code: 'assignment.no_targets', title: 'El objetivo no tiene vientres activos' });

    // Dedup: animales ya en una asignación ACTIVA del MISMO protocolo → se excluyen (no se re-aplica).
    const busy = await this.db.query<{ animal_id: string }>(
      `SELECT aa.animal_id FROM repro_protocol_assignment_animals aa
       JOIN repro_protocol_assignments pa ON pa.id = aa.assignment_id AND pa.status='active' AND pa.deleted_at IS NULL AND pa.protocol_id=$2
       WHERE aa.tenant_id=$1 AND aa.animal_id = ANY($3)`,
      [t, protocol.id, target.ids],
    );
    const busySet = new Set(busy.map((b) => b.animal_id));
    const ids = target.ids.filter((id) => !busySet.has(id));
    if (ids.length === 0) throw new ConflictException({ code: 'assignment.all_in_protocol', title: 'Todos los vientres ya están en este protocolo (activo)' });
    const steps: any[] = Array.isArray(protocol.steps) ? protocol.steps : [];

    return this.db.tx(async (q) => {
      const assignment = await q.one<any>(
        `INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, lot_id, target_type, category_code, start_date, animal_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, protocol_id, lot_id, target_type, start_date, animal_count, status, created_at`,
        [t, protocol.id, target.lotId, target.targetType, target.categoryCode, startDate, ids.length, this.db.user],
      );
      for (const animalId of ids)
        await q.query(`INSERT INTO repro_protocol_assignment_animals (tenant_id, assignment_id, animal_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [t, assignment.id, animalId]);

      const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [t]))?.id ?? null;
      let created = 0;
      for (const s of steps) {
        const due = new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + Number(s.day) * 86400000).toISOString();
        await this.tasks.createTask(
          q,
          { title: `${s.action} — ${target.label} (${ids.length} vientres)`, type: 'breeding', dueDate: due, priority: 'normal', relatedType: 'protocol_assignment', relatedId: assignment.id, farmId: farm },
          { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user },
        );
        created++;
      }
      return { assignment, target_type: target.targetType, animals: ids.length, skipped_in_protocol: busySet.size, tasks_created: created };
    });
  }

  /**
   * Completa un paso del protocolo para TODOS los animales de la asignación y registra el EVENTO REAL
   * según el `kind` del paso (insemination → servicio IATF; hormonal/device_removal → sincronización).
   * Idempotente por (assignment, step, animal); reaplicar no duplica. `diagnosis`/`review`/`other` solo
   * marcan el paso. Cierra también la tarea de grupo del paso.
   */
  async completeStep(assignmentId: string, stepIndex: number, body: any = {}) {
    const t = this.db.tenant;
    const assignment = await this.db.one<any>(
      `SELECT pa.id, pa.protocol_id, pa.status, pa.start_date::text AS start_date, pa.completed_steps, p.steps
       FROM repro_protocol_assignments pa JOIN repro_protocols p ON p.id = pa.protocol_id
       WHERE pa.id=$1 AND pa.tenant_id=$2 AND pa.deleted_at IS NULL`,
      [assignmentId, t],
    );
    if (!assignment) throw new NotFoundException({ code: 'assignment.not_found', title: 'Asignación no encontrada' });
    if (assignment.status !== 'active') throw new ConflictException({ code: 'assignment.not_active', title: 'La asignación no está activa' });
    const steps: any[] = Array.isArray(assignment.steps) ? assignment.steps : [];
    if (stepIndex < 0 || stepIndex >= steps.length) throw new BadRequestException({ code: 'assignment.invalid_step', title: 'Paso inválido' });
    const step = steps[stepIndex];
    const animals = await this.db.query<{ animal_id: string }>(`SELECT animal_id FROM repro_protocol_assignment_animals WHERE assignment_id=$1 AND tenant_id=$2`, [assignmentId, t]);
    const occurredAt = (body.occurred_at ?? new Date().toISOString()).slice(0, 10);
    const kind = step.kind ?? 'other';

    let eventsCreated = 0;
    for (const { animal_id } of animals) {
      const opKey = `protocol:${assignmentId}:${stepIndex}`;
      try {
        if (kind === 'insemination') {
          await this.service(animal_id, { method: 'ai', occurred_at: occurredAt, sire_id: body.sire_id, semen_batch_id: body.semen_batch_id, protocol_id: assignment.protocol_id, force: true }, this.deriveId(opKey, animal_id));
          eventsCreated++;
        } else if (kind === 'hormonal' || kind === 'device_removal') {
          const id = this.deriveId(opKey, animal_id);
          const exists = await this.db.one<any>(`SELECT id FROM breeding_events WHERE id=$1 AND tenant_id=$2`, [id, t]);
          if (!exists) {
            await this.db.query(
              `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, protocol_id, notes, created_by)
               VALUES ($1,$2,$3,'synchronization',$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
              [id, t, animal_id, occurredAt, assignment.protocol_id, step.action, this.db.user],
            );
            await insertAnimalEvent(this.db, animal_id, 'synchronization', { step: step.action, kind }, occurredAt);
            eventsCreated++;
          }
        }
      } catch (e) {
        if (process.env.REPRO_DEBUG) throw e;
        // un animal no apto (p. ej. macho por error, o sin saldo de semen) no aborta el resto.
      }
    }

    const completed: number[] = Array.isArray(assignment.completed_steps) ? assignment.completed_steps : [];
    if (!completed.includes(stepIndex)) completed.push(stepIndex);
    await this.db.query(`UPDATE repro_protocol_assignments SET completed_steps=$3::jsonb, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [assignmentId, t, JSON.stringify(completed)]);

    // Cierra la tarea de grupo del paso (por título) si sigue pendiente.
    await this.db.query(
      `UPDATE tasks SET status='done', completed_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND related_type='protocol_assignment' AND related_id=$2 AND status='pending' AND deleted_at IS NULL AND title LIKE $3`,
      [t, assignmentId, `${step.action} — %`],
    );

    return { assignment_id: assignmentId, step: stepIndex, kind, animals: animals.length, events_created: eventsCreated, completed_steps: completed };
  }

  /** Progreso de una asignación: pasos con estado (completado/pendiente) + cantidad de animales. */
  async assignmentProgress(assignmentId: string) {
    const t = this.db.tenant;
    const a = await this.db.one<any>(
      `SELECT pa.id, pa.status, pa.start_date::text AS start_date, pa.animal_count, pa.completed_steps,
              p.name AS protocol_name, p.steps
       FROM repro_protocol_assignments pa JOIN repro_protocols p ON p.id = pa.protocol_id
       WHERE pa.id=$1 AND pa.tenant_id=$2 AND pa.deleted_at IS NULL`,
      [assignmentId, t],
    );
    if (!a) throw new NotFoundException({ code: 'assignment.not_found', title: 'Asignación no encontrada' });
    const steps: any[] = Array.isArray(a.steps) ? a.steps : [];
    const done: number[] = Array.isArray(a.completed_steps) ? a.completed_steps : [];
    const start = new Date(`${a.start_date}T00:00:00.000Z`).getTime();
    return {
      id: a.id, protocol_name: a.protocol_name, status: a.status, animal_count: a.animal_count,
      steps_total: steps.length, steps_done: done.length,
      steps: steps.map((s, i) => ({
        index: i, day: s.day, action: s.action, kind: s.kind ?? 'other',
        due_date: new Date(start + Number(s.day) * 86400000).toISOString().slice(0, 10),
        completed: done.includes(i),
      })),
    };
  }

  /** Cancela una asignación activa y sus tareas `pending` (server-authored). Atómico. */
  async cancelAssignment(id: string) {
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const row = await q.one<{ id: string }>(
        `UPDATE repro_protocol_assignments SET status='canceled', updated_at=now()
         WHERE id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL RETURNING id`,
        [id, t],
      );
      if (!row) throw new NotFoundException({ code: 'assignment.not_found', title: 'Asignación no encontrada o ya cancelada' });
      const pending = await q.query<{ id: string }>(
        `SELECT id FROM tasks WHERE tenant_id=$1 AND related_type='protocol_assignment' AND related_id=$2 AND status='pending' AND deleted_at IS NULL`,
        [t, id],
      );
      let canceled = 0;
      for (const task of pending) {
        const res = await this.tasks.cancelTask(q, { taskId: task.id }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
        if (res.changed) canceled++;
      }
      return { id, canceled_tasks: canceled };
    });
  }

  /** Lista asignaciones (no eliminadas) con protocolo y lote. */
  async listAssignments() {
    return this.db.query(
      `SELECT pa.id, pa.protocol_id, p.name AS protocol_name, pa.lot_id, l.name AS lot_name,
              pa.start_date, pa.animal_count, pa.status, pa.created_at
       FROM repro_protocol_assignments pa
       LEFT JOIN repro_protocols p ON p.id = pa.protocol_id
       LEFT JOIN lots l ON l.id = pa.lot_id
       WHERE pa.tenant_id = $1 AND pa.deleted_at IS NULL
       ORDER BY pa.status, pa.start_date DESC`,
      [this.db.tenant],
    );
  }

  private async requireFemale(animalId: string) {
    const animal = await requireAnimal(this.db, animalId);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (animal.sex !== 'F')
      throw new BadRequestException({ code: 'repro.not_female', title: `${animal.tag} es macho: no admite eventos reproductivos de hembra` });
    return animal;
  }
}
