import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { TaskService, TaskContext, TaskType, TaskPriority } from './task.service';

/**
 * Reglas ganaderas AUTOMÁTICAS por condición del hato (Tareas E4). Materializa tareas
 * accionables desde el estado (no desde un evento puntual): sin pesaje reciente, vacuna vencida,
 * fin de retiro de medicamento y lote sin revisión. Escanea las tablas reales (como el motor de
 * alertas) y crea las tareas DELEGANDO en la regla única `TaskService.createTask` con `rule_key`
 * → DEDUP: una tarea viva por (regla, entidad). Idempotente: correrla de nuevo no duplica.
 * NO reemplaza las alertas (una alerta notifica; una tarea se asigna/completa). Los eventos
 * puntuales (parto/aborto/diagnóstico/protocolo) generan sus tareas en Repro/Sanidad.
 */
export interface MaterializeOptions {
  weighDays?: number; // sin pesaje en N días (default 60)
  lotReviewDays?: number; // lote sin pesaje/revisión en N días (default 30)
}

@Injectable()
export class TaskRulesService {
  constructor(
    private readonly db: DbService,
    private readonly tasks: TaskService,
  ) {}

  async materialize(opts: MaterializeOptions = {}): Promise<{ created: Record<string, number>; total: number }> {
    const weighDays = opts.weighDays ?? 60;
    const lotReviewDays = opts.lotReviewDays ?? 30;
    const t = this.db.tenant;
    const ctx: TaskContext = { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user };
    const today = await this.db.today();

    return this.db.tx(async (q) => {
      const created: Record<string, number> = {};

      // 1) Sin pesaje reciente → tarea de pesaje.
      const weigh = await q.query<any>(
        `SELECT a.id AS animal_id, ai.value AS tag
         FROM animals a
         LEFT JOIN LATERAL (SELECT weighed_at FROM v_weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) lw ON true
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
         WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
           AND (lw.weighed_at IS NULL OR lw.weighed_at < now() - ($2::int * INTERVAL '1 day'))
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.tenant_id = $1 AND tk.rule_key = 'weigh_due:' || a.id AND tk.deleted_at IS NULL AND tk.status IN ('pending','in_progress'))
         LIMIT 500`,
        [t, weighDays],
      );
      created.weigh_due = await this.emit(q, weigh, ctx, (r) => ({
        title: `Pesar — caravana ${r.tag ?? r.animal_id.slice(0, 6)}`,
        type: 'general',
        priority: 'normal',
        dueDate: today,
        relatedType: 'animal',
        relatedId: r.animal_id,
        ruleKey: `weigh_due:${r.animal_id}`,
      }));

      // 2) Vacuna vencida (próximo refuerzo pasado) → tarea de vacunación, una por animal.
      const vacc = await q.query<any>(
        `SELECT DISTINCT ON (v.animal_id) v.animal_id, v.next_due_date::text AS due, ai.value AS tag
         FROM vaccinations v
         JOIN animals a ON a.id = v.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
         WHERE v.tenant_id = $1 AND v.deleted_at IS NULL AND v.next_due_date IS NOT NULL AND v.next_due_date < CURRENT_DATE
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.tenant_id = $1 AND tk.rule_key = 'vaccine_due:' || v.animal_id AND tk.deleted_at IS NULL AND tk.status IN ('pending','in_progress'))
         ORDER BY v.animal_id, v.next_due_date DESC
         LIMIT 500`,
        [t],
      );
      created.vaccine_due = await this.emit(q, vacc, ctx, (r) => ({
        title: `Vacunar — caravana ${r.tag ?? r.animal_id.slice(0, 6)}`,
        type: 'health',
        priority: 'high',
        dueDate: r.due,
        relatedType: 'animal',
        relatedId: r.animal_id,
        ruleKey: `vaccine_due:${r.animal_id}`,
      }));

      // 3) Fin de retiro de medicamento → tarea/recordatorio al vencer el retiro.
      const wd = await q.query<any>(
        `SELECT tr.id AS treatment_id, tr.animal_id, tr.meat_withdrawal_until::text AS due, ai.value AS tag
         FROM treatments tr
         JOIN animals a ON a.id = tr.animal_id AND a.deleted_at IS NULL
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
         WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL AND tr.meat_withdrawal_until IS NOT NULL AND tr.meat_withdrawal_until >= CURRENT_DATE
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.tenant_id = $1 AND tk.rule_key = 'withdrawal_end:' || tr.id AND tk.deleted_at IS NULL AND tk.status IN ('pending','in_progress'))
         LIMIT 500`,
        [t],
      );
      created.withdrawal_end = await this.emit(q, wd, ctx, (r) => ({
        title: `Fin de retiro — caravana ${r.tag ?? r.animal_id.slice(0, 6)}`,
        type: 'health',
        priority: 'normal',
        dueDate: r.due,
        relatedType: 'animal',
        relatedId: r.animal_id,
        ruleKey: `withdrawal_end:${r.treatment_id}`,
      }));

      // 4) Lote sin revisión (ninguna pesada en N días) → tarea de revisión de lote.
      const lots = await q.query<any>(
        `SELECT l.id AS lot_id, l.name
         FROM lots l
         WHERE l.tenant_id = $1 AND l.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM animals a WHERE a.current_lot_id = l.id AND a.status = 'active' AND a.deleted_at IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM weighings w JOIN animals a ON a.id = w.animal_id
             WHERE a.current_lot_id = l.id AND w.deleted_at IS NULL AND w.weighed_at >= now() - ($2::int * INTERVAL '1 day'))
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.tenant_id = $1 AND tk.rule_key = 'lot_review:' || l.id AND tk.deleted_at IS NULL AND tk.status IN ('pending','in_progress'))
         LIMIT 200`,
        [t, lotReviewDays],
      );
      created.lot_review = await this.emit(q, lots, ctx, (r) => ({
        title: `Revisar lote — ${r.name}`,
        type: 'general',
        priority: 'normal',
        dueDate: today,
        relatedType: 'lot',
        relatedId: r.lot_id,
        ruleKey: `lot_review:${r.lot_id}`,
      }));

      // 5) Recurrentes (E5): instancias de plantillas cuyo next_due llegó y no tienen instancia viva.
      created.recurring = await this.generateRecurrences(q, ctx);

      const total = Object.values(created).reduce((a, b) => a + b, 0);
      return { created, total };
    });
  }

  // ──────────────────── Recurrencia (E5) ────────────────────

  /**
   * Genera la PRÓXIMA instancia de cada recurrencia activa cuyo `next_due` ya llegó y que no tiene
   * una tarea viva. Una viva a la vez (dedup por recurrence_id + rule_key `recur:<id>`), sin duplicar
   * infinitamente. `next_due` avanza al COMPLETAR la instancia (TaskService.completeTask), no acá.
   */
  private async generateRecurrences(q: Q, ctx: TaskContext): Promise<number> {
    const t = this.db.tenant;
    const due = await q.query<any>(
      `SELECT r.id, r.title, r.description, r.type, r.priority, r.assigned_to, r.related_type, r.related_id, r.farm_id, r.next_due::text AS next_due
       FROM task_recurrences r
       WHERE r.tenant_id = $1 AND r.active = true AND r.deleted_at IS NULL AND r.next_due <= CURRENT_DATE
         AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.recurrence_id = r.id AND tk.deleted_at IS NULL AND tk.status IN ('pending','in_progress'))
       LIMIT 500`,
      [t],
    );
    let n = 0;
    for (const r of due) {
      const res = await this.tasks.createTask(
        q,
        {
          title: r.title,
          description: r.description ?? null,
          type: (r.type ?? 'general') as TaskType,
          priority: (r.priority ?? 'normal') as TaskPriority,
          dueDate: r.next_due,
          relatedType: r.related_type ?? null,
          relatedId: r.related_id ?? null,
          assignedTo: r.assigned_to ?? null,
          farmId: r.farm_id ?? null,
          recurrenceId: r.id,
          ruleKey: `recur:${r.id}`,
        },
        ctx,
      );
      if (!res.already) n++;
    }
    return n;
  }

  /** Crea una plantilla de recurrencia (E5) y genera su primera instancia si ya vence. */
  async createRecurrence(body: any): Promise<{ id: string; generated: number }> {
    const t = this.db.tenant;
    const title = (body?.title ?? '').trim();
    if (!title) throw new BadRequestException({ code: 'recurrence.missing_title', title: 'El título es obligatorio' });
    const interval = Number(body?.interval_days);
    if (!Number.isFinite(interval) || interval <= 0) throw new BadRequestException({ code: 'recurrence.invalid_interval', title: 'interval_days debe ser > 0' });
    const anchor = body?.anchor === 'completed_at' ? 'completed_at' : 'due_date';
    const nextDue = (body?.next_due ?? await this.db.today()).slice(0, 10);
    const ctx: TaskContext = { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user };

    return this.db.tx(async (q) => {
      const farmId = body?.farm_id ?? (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]))?.id ?? null;
      const row = await q.one<{ id: string }>(
        `INSERT INTO task_recurrences (tenant_id, farm_id, title, description, type, priority, assigned_to, related_type, related_id, interval_days, anchor, next_due, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [t, farmId, title, body?.description ?? null, body?.type ?? 'general', body?.priority ?? 'normal', body?.assigned_to ?? null, body?.related_type ?? null, body?.related_id ?? null, Math.floor(interval), anchor, nextDue, this.db.user],
      );
      const generated = await this.generateRecurrences(q, ctx);
      return { id: row!.id, generated };
    });
  }

  /** Lista las plantillas de recurrencia con su próxima fecha (E5). */
  async listRecurrences(): Promise<Record<string, unknown>[]> {
    return this.db.query(
      `SELECT r.id, r.title, r.type, r.priority, r.interval_days, r.anchor, r.next_due::text AS next_due, r.active,
              COALESCE(u.full_name, u.email) AS assignee_name
       FROM task_recurrences r LEFT JOIN users u ON u.id = r.assigned_to
       WHERE r.tenant_id = $1 AND r.deleted_at IS NULL ORDER BY r.active DESC, r.next_due`,
      [this.db.tenant],
    );
  }

  /** Desactiva (soft) una recurrencia: no genera más instancias. Las tareas ya creadas siguen. */
  async deactivateRecurrence(id: string): Promise<{ ok: boolean }> {
    const t = this.db.tenant;
    const r = await this.db.one<{ id: string }>(`SELECT id FROM task_recurrences WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, t]);
    if (!r) throw new NotFoundException({ code: 'recurrence.not_found', title: 'Recurrencia no encontrada' });
    await this.db.query(`UPDATE task_recurrences SET active = false, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, t]);
    return { ok: true };
  }

  /** Crea una tarea por fila del scan vía la regla única; cuenta las realmente nuevas (dedup). */
  private async emit(
    q: Q,
    rows: any[],
    ctx: TaskContext,
    build: (r: any) => { title: string; type: TaskType; priority: TaskPriority; dueDate: string | null; relatedType: string; relatedId: string; ruleKey: string },
  ): Promise<number> {
    let n = 0;
    for (const r of rows) {
      const res = await this.tasks.createTask(q, build(r), ctx);
      if (!res.already) n++;
    }
    return n;
  }
}
