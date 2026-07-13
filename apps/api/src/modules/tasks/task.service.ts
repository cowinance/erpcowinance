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
}

export interface CompleteTaskInput {
  taskId: string;
  /** sync: instante efectivo de la acción offline del device; REST/Sanidad: default now() del servidor. */
  completedAt?: string;
}

/** Campos de la tarea que viajan por sync (put/LWW) y se versionan. */
const TASK_SYNC_FIELDS = ['title', 'description', 'type', 'status', 'due_date', 'priority', 'related_type', 'related_id', 'completed_at'] as const;

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
    // Resolver la finca por el MISMO `q` de la operación (no `this.db`, que iría al pool y
    // haría deadlock con la única conexión de PGlite dentro de una tx). farm_id es nullable.
    const farmId =
      input.farmId ??
      (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]))?.id ??
      null;
    const hlc = ctx.hlc ?? this.serverClock.tick();

    await q.query(
      `INSERT INTO tasks (id, tenant_id, farm_id, title, description, type, due_date, priority, status, related_type, related_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [taskId, t, farmId, title, description, type, dueDate, priority, relatedType, relatedId, ctx.actorUserId],
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
    };
    await this.versions.write(q, 'tasks', taskId, Object.fromEntries(TASK_SYNC_FIELDS.map((f) => [f, hlc])));

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: taskId, fields, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:create:${taskId}`);
    return { taskId, syncOp };
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
    if (existing.status !== 'pending')
      throw new BadRequestException({ code: 'task.invalid_transition', title: `Transición no permitida en P6-1: ${existing.status} → done` });

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
    return { status: 'done', changed: true, syncOp };
  }

  /**
   * Cancela una tarea (P6-2, diff-aware e idempotente). `pending → canceled` permitido;
   * `canceled → canceled` no-op; cualquier otra transición se rechaza (`done` es terminal).
   * Versiona `status`. Emite server-origin SOLO si `ctx.emitServerOrigin`.
   */
  async cancelTask(q: Q, input: { taskId: string }, ctx: TaskContext): Promise<{ status: string; changed: boolean; syncOp: PutOp | null }> {
    const t = this.db.tenant;
    const existing = await q.one<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.taskId, t],
    );
    if (!existing) throw new NotFoundException({ code: 'task.not_found', title: 'Tarea no encontrada' });

    if (existing.status === 'canceled') return { status: 'canceled', changed: false, syncOp: null }; // idempotente
    if (existing.status !== 'pending')
      throw new BadRequestException({ code: 'task.invalid_transition', title: `Transición no permitida: ${existing.status} → canceled` });

    const hlc = ctx.hlc ?? this.serverClock.tick();
    await q.query(`UPDATE tasks SET status = 'canceled', updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.taskId, t]);

    const existingV = (await this.versions.read(q, 'tasks', input.taskId)) ?? {};
    await this.versions.write(q, 'tasks', input.taskId, { ...existingV, status: hlc });

    const syncOp: PutOp = { kind: 'put', table: 'tasks', rowId: input.taskId, fields: { status: 'canceled' }, hlc };
    if (ctx.emitServerOrigin) await this.serverOrigin.emit(q, [syncOp], `task:cancel:${input.taskId}`);
    return { status: 'canceled', changed: true, syncOp };
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
