import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { addFarmDays, InvalidProtocolStepsError, validateProtocolSteps } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { TaskService } from '../tasks/task.service';
import { ServicePlanService } from './service-plan.service';
import { ReproService } from './repro.service';
import { insertAnimalEvent } from '../../common/events';

/**
 * Protocolos de sincronización (IATF): plantillas, asignación a un lote y avance paso a paso.
 *
 * Sale de `ReproService` porque es otra cosa. Aquél registra HECHOS reproductivos —un celo, un
 * servicio, un diagnóstico, un parto—, uno por animal y en el momento en que ocurren. Un protocolo
 * es un PLAN: una plantilla de pasos que se asigna a un grupo entero y se va cumpliendo en fechas
 * previstas, generando tareas. Tenerlos juntos hacía que el servicio de reproducción creciera sin
 * un límite natural, y el gate de tamaño lo marcó — que es exactamente para lo que está.
 *
 * Depende de `ReproService` en un solo sentido —al completar el paso de inseminación registra el
 * servicio con la regla única— y nunca al revés.
 */
@Injectable()
export class ProtocolService {
  constructor(
    private readonly db: DbService,
    private readonly tasks: TaskService,
    private readonly plans: ServicePlanService,
    private readonly repro: ReproService,
  ) {}

  /** id determinista uuid-like a partir de una clave de idempotencia + discriminante. */
  private deriveId(baseKey: string, discriminator: string): string {
    const h = createHash('sha1').update(`${baseKey}:${discriminator}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

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
        // Fecha CALENDARIO como texto, no un instante en UTC. `due_date` es `timestamptz`: si se
        // guarda la medianoche de UTC, al leerla en la zona de la finca cae el día anterior. Pasando
        // `YYYY-MM-DD`, PostgreSQL la interpreta en la zona de la sesión —la de la finca— y el ida y
        // vuelta cierra: el paso «día 8» se lee el día 8.
        const due = addFarmDays(startDate, Number(s.day));
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
    // Se trae también la revisión: un vientre marcado «no apta» no entra a la jornada. Servirlo
    // igual gastaría una pajuela en un animal que la ecografía ya descartó.
    const animals = await this.db.query<{ animal_id: string; eligibility: string }>(
      `SELECT animal_id, eligibility FROM repro_protocol_assignment_animals WHERE assignment_id=$1 AND tenant_id=$2`,
      [assignmentId, t],
    );
    const occurredAt = (body.occurred_at ? String(body.occurred_at).slice(0, 10) : await this.db.today());
    const kind = step.kind ?? 'other';

    let eventsCreated = 0;
    let skippedNotEligible = 0;
    for (const { animal_id, eligibility } of animals) {
      const opKey = `protocol:${assignmentId}:${stepIndex}`;
      if (kind === 'insemination' && eligibility === 'not_eligible') {
        skippedNotEligible++;
        continue;
      }
      try {
        if (kind === 'insemination') {
          // GT-3: si el vientre tiene PLAN, la jornada lo ejecuta — su propio toro y su propia
          // pajuela. Sin plan se cae al comportamiento de siempre (un mismo semen para el grupo),
          // que sigue siendo lo correcto para una IATF donde todas van con el mismo toro.
          const plan = await this.plans.planFor(assignmentId, animal_id);
          const evento = await this.repro.service(
            animal_id,
            plan
              ? {
                  method: plan.method === 'embryo_transfer' ? 'embryo_transfer' : 'ai',
                  occurred_at: occurredAt,
                  sire_id: body.sire_id,
                  semen_batch_id: plan.semen_batch_id ?? undefined,
                  embryo_id: plan.embryo_id ?? undefined,
                  straw_id: plan.straw_id ?? undefined,
                  protocol_id: assignment.protocol_id,
                  force: true,
                }
              : { method: 'ai', occurred_at: occurredAt, sire_id: body.sire_id, semen_batch_id: body.semen_batch_id, protocol_id: assignment.protocol_id, force: true },
            this.deriveId(opKey, animal_id),
          );
          if (plan && evento?.id) await this.plans.markServed(assignmentId, animal_id, evento.id, evento.straw_ids?.[0] ?? null);
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

    return {
      assignment_id: assignmentId,
      step: stepIndex,
      kind,
      animals: animals.length,
      events_created: eventsCreated,
      skipped_not_eligible: skippedNotEligible,
      completed_steps: completed,
    };
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
    const start = String(a.start_date).slice(0, 10);
    return {
      id: a.id, protocol_name: a.protocol_name, status: a.status, animal_count: a.animal_count,
      steps_total: steps.length, steps_done: done.length,
      steps: steps.map((s, i) => ({
        index: i, day: s.day, action: s.action, kind: s.kind ?? 'other',
        due_date: addFarmDays(start, Number(s.day)),
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

}
