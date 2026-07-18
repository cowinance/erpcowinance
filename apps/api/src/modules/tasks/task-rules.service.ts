import { Injectable } from '@nestjs/common';
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
    const today = new Date().toISOString().slice(0, 10);

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

      const total = Object.values(created).reduce((a, b) => a + b, 0);
      return { created, total };
    });
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
