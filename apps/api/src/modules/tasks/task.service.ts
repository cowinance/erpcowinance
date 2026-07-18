import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HlcClock } from '@cowinance/sync-core';
import type { PutOp } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

/**
 * Núcleo NEUTRAL de tareas (P6-1). Fuente ÚNICA del «cómo» se crea y cambia de estado una
 * tarea, reutilizada por todos los canales: REST general, Sanidad (que decide QUÉ tarea
 * clínica debe existir y delega el CÓMO acá) y —en P6-1.b— el `TaskSyncHandler`.
 *
 * La tarea es una entidad MUTABLE sincronizada por put + LWW (patrón `pregnancies`), no un
 * hecho inmutable. El CONTEXTO es explícito (`origin`, `emitServerOrigin`, `hlc`,
 * `actorUserId`): el server-origin NO es implícito — se emite SOLO para mutaciones
 * server-authored (REST/web/Sanidad, `emitServerOrigin=true`). Nunca como eco de una
 * mutación aceptada del dispositivo (el `TaskSyncHandler` llamará con `emitServerOrigin=false`).
 *
 * Contrato de estados de P6-1 (restringido a propósito, aunque el CHECK de la base admita
 * más): creación en `pending`; transición `pending → done`. `done → done` es no-op
 * idempotente. Cualquier otra transición se rechaza (`task.invalid_transition`) — así no se
 * publica funcionalidad sin consumidor (`in_progress`/`canceled` llegan con su ola).
 */

export type TaskOrigin = 'rest' | 'health' | 'sync' | 'repro';
export type TaskType = 'health' | 'breeding' | 'feeding' | 'maintenance' | 'crop' | 'general';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskContext {
  origin: TaskOrigin;
  /** true SOLO para mutaciones server-authored (REST/web/Sanidad). El sync llama con false. */
  emitServerOrigin: boolean;
  actorUserId: string;
  /** Reloj de la mutación; server tick por defecto. En sync = HLC del op. */
  hlc?: string;
}

export interface CreateTaskInput {
  /** sync: op.rowId; REST/Sanidad: undefined → uuid del servidor. */
  taskId?: string;
  title: string;
  type?: TaskType;
  description?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  relatedType?: string | null;
  relatedId?: string | null;
  farmId?: string | null;
  assignedTo?: string | null;
  /** Clave de dedup para tareas AUTOGENERADAS (E4): una viva por (tenant, rule_key). */
  ruleKey?: string | null;
}

export interface CompleteTaskInput {
  taskId: string;
  /** sync: instante efectivo de la acción offline del device; REST/Sanidad: default now() del servidor. */
  completedAt?: string;
}

/** Campos de la tarea que viajan por sync (put/LWW) y se versionan. `assigned_to` se suma
 * (mejora a centro operativo) para que la asignación converja en devices ("asignadas a mí"). */
const TASK_SYNC_FIELDS = ['title', 'description', 'type', 'status', 'due_date', 'priority', 'related_type', 'related_id', 'completed_at', 'assigned_to'] as const;

/** Estados desde los que se puede reprogramar / iniciar / seguir mutando (no terminales). */
const OPEN_STATUSES = new Set(['pending', 'in_progress']);

@Injectable()
export class TaskService {
  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly serverOrigin: ServerOriginChangesetWriter,
  ) {}

  /**
   * Crea una tarea en `pending`, atómica e idempotente por `id`. Escribe la fila + las
   * versiones LWW; emite server-origin SOLO si `ctx.emitServerOrigin`.
   */
  async createTask(q: Q, input: CreateTaskInput, ctx: TaskContext): Promise<{ taskId: string; syncOp: PutOp }> {
    const t = this.db.tenant;
    const title = (input.title ?? '').trim();
    if (!title) throw new BadRequestException({ code: 'task.missing_title', title: 'El título es obligatorio' });

    const taskId = input.taskId ?? randomUUID();
    const type = input.type ?? 'general';
    const priority = input.priority ?? 'normal';
    const dueDate = input.dueDate ?? null;
    const description = input.description ?? null;
    const relatedType = input.relatedType ?? null;
    const relatedId = input.relatedId ?? null;
    const assignedTo = input.assignedTo ?? null;
    const ruleKey = input.ruleKey ?? null;
    // Resolver la finca por el MISMO `q` de la operación (no `this.db`, que iría al pool y
    // haría deadlock con la única conexión de PGlite dentro de una tx). farm_id es nullable.
    const farmId =
      input.farmId ??
      (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]))?.id ??
      null;
    const hlc = ctx.hlc ?? this.serverClock.tick();

    await q.query(
      `INSERT INTO tasks (id, tenant_id, farm_id, title, description, type, due_date, priority, status, related_type, related_id, assigned_to, rule_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [taskId, t, farmId, title, description, type, dueDate, priority, relatedType, relatedId, assignedTo, ruleKey, ctx.actorUserId],
    );

    const fields: Record<string, unknown> = {
      title,
      description,
      type,
      status: 'pending',
      due_date: dueDate,
      priority,
      related_type: relatedType,
      related_id: relatedId,
      completed_at: null,
      assigned_to: assignedTo,
    };
    await this.versions.write(q, 'tasks', taskId, Object.fromEntries(TASK_SYNC_FIELDS.map((f) => [f, hlc])));

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: taskId, fields, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:create:${taskId}`);
    await this.recordEvent(q, taskId, 'created', { to: 'pending' }, ctx);
    return { taskId, syncOp };
  }

  /** Registra un evento de trazabilidad de la tarea (historial). Server-authored, no sincroniza. */
  private async recordEvent(
    q: Q,
    taskId: string,
    kind: 'created' | 'status_change' | 'rescheduled' | 'assigned' | 'priority_change' | 'comment',
    data: { from?: string | null; to?: string | null; note?: string | null },
    ctx: TaskContext,
  ): Promise<void> {
    await q.query(
      `INSERT INTO task_events (tenant_id, task_id, kind, from_value, to_value, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [this.db.tenant, taskId, kind, data.from ?? null, data.to ?? null, data.note ?? null, ctx.actorUserId ?? null],
    );
  }

  /**
   * Completa una tarea (diff-aware, idempotente). `pending → done` permitido; `done → done`
   * no-op; cualquier otra transición se rechaza. `completed_at` + `status` se escriben y
   * versionan juntos. REST/Sanidad usan hora del servidor; sync conserva el `completedAt`
   * del device. Emite server-origin SOLO si `ctx.emitServerOrigin`.
   */
  async completeTask(q: Q, input: CompleteTaskInput, ctx: TaskContext): Promise<{ status: string; changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });

    if (existing.status === 'done') return { status: 'done', changed: false, syncOp: null }; // idempotente
    // Transiciones válidas → done: pending → done, in_progress → done.
    if (!OPEN_STATUSES.has(existing.status))
      throw new BadRequestException({ code: 'task.invalid_transition', title: `Transición no permitida: ${existing.status} → done` });

    const completedAt = input.completedAt ?? new Date().toISOString();
    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET status = 'done', completed_at = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      input.taskId,
      t,
      completedAt,
    ]);

    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, status: hlc, completed_at: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { status: 'done', completed_at: completedAt }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:complete:${input.taskId}`);
    await this.recordEvent(q, input.taskId, 'status_change', { from: existing.status, to: 'done' }, ctx);
    return { status: 'done', changed: true, syncOp };
  }

  /**
   * Cancela una tarea (P6-2, diff-aware e idempotente). `pending → canceled` permitido;
   * `canceled → canceled` no-op; cualquier otra transición se rechaza (`done` es terminal).
   * Versiona `status`. Emite server-origin SOLO si `ctx.emitServerOrigin`.
   */
  async cancelTask(q: Q, input: { taskId: string; reason?: string | null }, ctx: TaskContext): Promise<{ status: string; changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });

    if (existing.status === 'canceled') return { status: 'canceled', changed: false, syncOp: null }; // idempotente
    // pending → canceled, in_progress → canceled. `done` es terminal.
    if (!OPEN_STATUSES.has(existing.status))
      throw new BadRequestException({ code: 'task.invalid_transition', title: `Transición no permitida: ${existing.status} → canceled` });

    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET status = 'canceled', updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.taskId, t]);

    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, status: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { status: 'canceled' }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:cancel:${input.taskId}`);
    await this.recordEvent(q, input.taskId, 'status_change', { from: existing.status, to: 'canceled', note: input.reason ?? null }, ctx);
    return { status: 'canceled', changed: true, syncOp };
  }

  /**
   * Inicia una tarea (`pending → in_progress`, mejora a centro operativo). `in_progress → in_progress`
   * no-op idempotente; `done`/`canceled` terminales → rechazo. Versiona `status`, historial.
   */
  async startTask(q: Q, input: { taskId: string }, ctx: TaskContext): Promise<{ status: string; changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });
    if (existing.status === 'in_progress') return { status: 'in_progress', changed: false, syncOp: null };
    if (existing.status !== 'pending')
      throw new BadRequestException({ code: 'task.invalid_transition', title: `Transición no permitida: ${existing.status} → in_progress` });

    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET status = 'in_progress', updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.taskId, t]);
    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, status: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { status: 'in_progress' }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:start:${input.taskId}`);
    await this.recordEvent(q, input.taskId, 'status_change', { from: existing.status, to: 'in_progress' }, ctx);
    return { status: 'in_progress', changed: true, syncOp };
  }

  /**
   * Reprograma la tarea (cambia `due_date`, con motivo opcional). Permitido en estados abiertos
   * (`pending`/`in_progress`); `done`/`canceled` → rechazo. Diff-aware (misma fecha = no-op).
   * Versiona `due_date`, deja historial `rescheduled` (from/to + motivo). Emite server-origin opcional.
   */
  async rescheduleTask(
    q: Q,
    input: { taskId: string; dueDate: string | null; reason?: string | null },
    ctx: TaskContext,
  ): Promise<{ changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string; due_date: string | null }>(
      `SELECT id, status, due_date::text AS due_date FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });
    if (!OPEN_STATUSES.has(existing.status))
      throw new BadRequestException({ code: 'task.invalid_transition', title: `No se puede reprogramar una tarea ${existing.status}` });

    const newDue = input.dueDate ?? null;
    const curDue = existing.due_date ?? null;
    // due_date es timestamptz → comparar por instante (una fecha y su timestamptz coinciden).
    const same =
      (curDue == null && newDue == null) ||
      (curDue != null && newDue != null && new Date(curDue).getTime() === new Date(newDue).getTime());
    if (same) return { changed: false, syncOp: null }; // no-op

    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET due_date = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.taskId, t, newDue]);
    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, due_date: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { due_date: newDue }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:reschedule:${input.taskId}:${hlc}`);
    await this.recordEvent(q, input.taskId, 'rescheduled', { from: curDue, to: newDue, note: input.reason ?? null }, ctx);
    return { changed: true, syncOp };
  }

  /**
   * Asigna la tarea a un usuario/empleado (o la desasigna con null). Diff-aware. Versiona
   * `assigned_to` (sincroniza → "asignadas a mí" en devices). Historial `assigned`.
   */
  async assignTask(
    q: Q,
    input: { taskId: string; assignedTo: string | null },
    ctx: TaskContext,
  ): Promise<{ changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string; assigned_to: string | null }>(
      `SELECT id, status, assigned_to FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });
    const newAssignee = input.assignedTo ?? null;
    if ((existing.assigned_to ?? null) === newAssignee) return { changed: false, syncOp: null };
    if (newAssignee) {
      const user = await q.one<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [newAssignee]);
      if (!user) throw new BadRequestException({ code: 'task.invalid_assignee', title: 'Usuario responsable inexistente' });
    }

    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET assigned_to = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.taskId, t, newAssignee]);
    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, assigned_to: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { assigned_to: newAssignee }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:assign:${input.taskId}:${hlc}`);
    await this.recordEvent(q, input.taskId, 'assigned', { from: existing.assigned_to, to: newAssignee }, ctx);
    return { changed: true, syncOp };
  }

  /** Lectura mínima (P6-1: verificación + preparación de la lista web de P6-2). */
  async list(status?: string): Promise<Record<string, unknown>[]> {
    const args: unknown[] = [this.db.tenant];
    const where = [`tenant_id = $1`, `deleted_at IS NULL`];
    if (status && status !== 'all') {
      args.push(status);
      where.push(`status = $${args.length}`);
    }
    return this.db.query(
      `SELECT id, title, description, type, due_date, priority, status, related_type, related_id, completed_at
       FROM tasks WHERE ${where.join(' AND ')} ORDER BY due_date NULLS LAST, created_at`,
      args,
    );
  }
}
