import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis, newbornCategoryCode, validateProtocolSteps, InvalidProtocolStepsError } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';

@Injectable()
export class ReproService {
  constructor(
    private readonly db: DbService,
    private readonly weanings: WeaningService,
    private readonly tasks: TaskService,
    private readonly semen: SemenService,
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
    // Consumo de pajuela (G-2a): solo en inseminación artificial con partida indicada. Se descuenta
    // ANTES de registrar el servicio (regla única del saldo de semen); si no alcanza (403), no queda
    // ni el servicio ni el consumo. En una request todo comparte la misma tx; el móvil/sync aún no
    // envía semen_batch_id (paridad diferida).
    const semenBatchId = method === 'service_ai' && body?.semen_batch_id ? body.semen_batch_id : null;
    if (semenBatchId) await this.semen.adjustStraws(semenBatchId, -1, 'insemination');
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id, semen_batch_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, type, occurred_at`,
      [this.db.tenant, animalId, method, occurredAt, body?.sire_id ?? null, semenBatchId, body?.notes ?? null, this.db.user],
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

  /**
   * Estado reproductivo del rodeo (R-1): cada vientre ACTIVO (vaca/vaquillona) con su estado
   * snapshot. Orden estricto: preñada > (último servicio vs último diagnóstico negativo) > sin
   * actividad. Vientre = mismo criterio que `kpis()`. Snapshot (dueño repro), no período.
   */
  async herdStatus(lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(
      `SELECT a.id AS animal_id, ai.value AS tag, a.name, l.name AS lot,
              p.expected_due_date,
              (p.expected_due_date - CURRENT_DATE)::int AS days_until,
              s.last_service, neg.last_neg,
              (p.preg IS NOT NULL) AS pregnant
       FROM animals a
       JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca', 'vaquillona')
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type = 'visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN LATERAL (SELECT 1 AS preg, expected_due_date FROM pregnancies WHERE animal_id = a.id AND status = 'open' AND deleted_at IS NULL ORDER BY diagnosis_date DESC LIMIT 1) p ON true
       LEFT JOIN LATERAL (SELECT max(occurred_at) AS last_service FROM breeding_events WHERE animal_id = a.id AND type IN ('service_natural', 'service_ai', 'embryo_transfer') AND deleted_at IS NULL) s ON true
       LEFT JOIN LATERAL (SELECT max(occurred_at) AS last_neg FROM animal_events WHERE animal_id = a.id AND event_type = 'pregnancy_negative' AND deleted_at IS NULL) neg ON true
       WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL${lotFilter}
       ORDER BY ai.value NULLS LAST`,
      params,
    );

    const statusOf = (r: any): 'pregnant' | 'served' | 'empty' | 'idle' => {
      if (r.pregnant) return 'pregnant';
      const svc = r.last_service ? new Date(r.last_service).getTime() : null;
      const neg = r.last_neg ? new Date(r.last_neg).getTime() : null;
      if (svc == null && neg == null) return 'idle';
      if (svc != null && (neg == null || svc > neg)) return 'served';
      return 'empty';
    };

    const counts = { pregnant: 0, served: 0, empty: 0, idle: 0, total: rows.length };
    const out = rows.map((r) => {
      const status = statusOf(r);
      counts[status]++;
      return {
        animal_id: r.animal_id,
        tag: r.tag ?? null,
        name: r.name ?? null,
        lot: r.lot ?? null,
        status,
        expected_due_date: status === 'pregnant' ? r.expected_due_date : null,
        days_until: status === 'pregnant' ? r.days_until : null,
        last_service_date: r.last_service ?? null,
      };
    });
    return { lot_id: lotId ?? null, counts, rows: out };
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

  // ── Asignación de protocolos a un lote (R-2.b.1) ─────────────────────────────
  /**
   * Asigna un protocolo a los vientres activos de un lote desde `start_date`; genera UNA tarea por
   * paso (nivel grupo) vía TaskService (server-authored → sincroniza + agenda). Atómico (db.tx).
   */
  async assignProtocol(body: any) {
    const startDate = String(body?.start_date ?? '').slice(0, 10);
    if (!body?.protocol_id || !body?.lot_id || !startDate) {
      throw new BadRequestException({ code: 'assignment.missing_fields', title: 'protocol_id, lot_id y start_date son obligatorios' });
    }
    if (Number.isNaN(new Date(`${startDate}T00:00:00.000Z`).getTime())) {
      throw new BadRequestException({ code: 'assignment.invalid_date', title: `start_date inválida: ${startDate}` });
    }
    const t = this.db.tenant;
    const protocol = await this.db.one<any>(`SELECT id, name, steps FROM repro_protocols WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.protocol_id, t]);
    if (!protocol) throw new NotFoundException({ code: 'protocol.not_found', title: 'Protocolo no encontrado' });
    const lot = await this.db.one<{ id: string; name: string }>(`SELECT id, name FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.lot_id, t]);
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const grp = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals a JOIN animal_categories c ON c.id=a.category_id AND c.code IN ('vaca','vaquillona')
       WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND a.current_lot_id=$2`,
      [t, lot.id],
    );
    const count = grp?.n ?? 0;
    const steps: any[] = Array.isArray(protocol.steps) ? protocol.steps : [];

    return this.db.tx(async (q) => {
      const assignment = await q.one<any>(
        `INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, lot_id, start_date, animal_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, protocol_id, lot_id, start_date, animal_count, status, created_at`,
        [t, protocol.id, lot.id, startDate, count, this.db.user],
      );
      const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [t]))?.id ?? null;
      let created = 0;
      for (const s of steps) {
        const due = new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + Number(s.day) * 86400000).toISOString();
        await this.tasks.createTask(
          q,
          { title: `${s.action} — ${lot.name} (${count} vientres)`, type: 'breeding', dueDate: due, priority: 'normal', relatedType: 'protocol_assignment', relatedId: assignment.id, farmId: farm },
          { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user },
        );
        created++;
      }
      return { assignment, tasks_created: created };
    });
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
