import { BadRequestException, HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import type { SyncHandler, SyncConflict } from '../sync/contracts/sync-handler.interface';
import { SyncConflictWriter } from '../sync/registry/sync-conflict.writer';
import { SyncHandlerRegistry } from '../sync/registry/sync-handler.registry';
import { TaskService, TaskPriority } from './task.service';

/**
 * tasks: canal de sync ENTRANTE (P6-1.b). El móvil crea/completa tareas offline como `put`;
 * este handler los aplica DELEGANDO en la regla única `TaskService` (D3, no reimplementa el
 * «cómo»). Discrimina intención por fila existente (patrón `pregnancies`): no existe → crear;
 * existe → mutar. **Sin server-origin** (D2): el changeset del device ya propaga por pull.
 *
 * Saneamiento de la creación desde el dispositivo: `op.rowId` = taskId; solo se aceptan
 * `title`/`description`/`due_date`/`priority`; se FUERZA `type='general'` y `status='pending'`;
 * los campos reservados al servidor (`type≠general`, `related_*`, `assigned_to`, `created_by`,
 * `status` en creación) se ignoran. `title` ausente → conflicto.
 *
 * Contrato de estados de P6-1: `pending → done` (con `completed_at` del device, D2);
 * `done → done` no-op; cualquier otra transición o cambio de campo → conflicto semántico
 * (sin publicar funcionalidad sin consumidor). Rechazos de dominio → `SyncConflict` (no throw).
 *
 * Vive en `tasks/` (ADR-0008), se auto-registra en el `SyncHandlerRegistry` al arrancar.
 */
const DOMAIN_REJECTIONS = new Set([
  'task.missing_title',
  'task.invalid_transition',
  'task.not_found',
  'task.invalid_assignee', // asignar offline a un usuario que no existe/no es del tenant → conflicto
]);
const PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

@Injectable()
export class TaskSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'tasks' as const;

  constructor(
    private readonly db: DbService,
    private readonly tasks: TaskService,
    private readonly conflictWriter: SyncConflictWriter,
    private readonly registry: SyncHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]> {
    if (op.kind !== 'put') {
      throw new BadRequestException({ code: 'sync.unsupported_op', title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}` });
    }
    const t = this.db.tenant;
    const conflicts: SyncConflict[] = [];
    const fields = op.fields;
    const existing = await q.one<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [op.rowId, t],
    );

    try {
      if (!existing) {
        // CREAR (saneado): fuerza type=general/status=pending; ignora campos reservados.
        const priority = fields['priority'];
        await this.tasks.createTask(
          q,
          {
            taskId: op.rowId,
            title: typeof fields['title'] === 'string' ? (fields['title'] as string) : '',
            description: (fields['description'] as string | null) ?? null,
            dueDate: (fields['due_date'] as string | null) ?? null,
            priority: PRIORITIES.has(priority as TaskPriority) ? (priority as TaskPriority) : undefined,
          },
          { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user },
        );
      } else if (fields['status'] === 'done') {
        // COMPLETAR: requiere completed_at del device (D2: el servidor no lo deriva).
        const completedAt = fields['completed_at'];
        if (typeof completedAt !== 'string' || !completedAt) {
          conflicts.push({ type: 'semantic', entity_id: op.rowId, detail: 'Completar sin completed_at (task.complete_missing_at)' });
        } else {
          await this.tasks.completeTask(q, { taskId: op.rowId, completedAt }, { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user });
        }
      } else if (fields['status'] === 'in_progress') {
        // INICIAR offline (mejora a centro operativo): pending → in_progress.
        await this.tasks.startTask(q, { taskId: op.rowId }, { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user });
      } else if (fields['status'] === 'canceled') {
        // CANCELAR offline.
        await this.tasks.cancelTask(q, { taskId: op.rowId }, { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user });
      } else if (fields['due_date'] !== undefined && fields['status'] === undefined) {
        // REPROGRAMAR offline: solo cambia due_date (sin cambio de estado).
        await this.tasks.rescheduleTask(
          q,
          { taskId: op.rowId, dueDate: (fields['due_date'] as string | null) ?? null },
          { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user },
        );
      } else if (fields['assigned_to'] !== undefined && fields['status'] === undefined && fields['due_date'] === undefined) {
        // ASIGNAR offline (paridad móvil): solo cambia el responsable. `null` = desasignar.
        // La regla única valida que el usuario pertenezca al tenant (assignTask).
        await this.tasks.assignTask(
          q,
          { taskId: op.rowId, assignedTo: (fields['assigned_to'] as string | null) ?? null },
          { origin: 'sync', emitServerOrigin: false, hlc: op.hlc, actorUserId: this.db.user },
        );
      } else {
        // Fila existente, put fuera del contrato soportado → conflicto semántico.
        conflicts.push({ type: 'semantic', entity_id: op.rowId, detail: 'Cambio no soportado (task.unsupported_change)' });
      }
    } catch (e) {
      if (e instanceof HttpException) {
        const resp = e.getResponse() as { code?: string };
        if (resp?.code && DOMAIN_REJECTIONS.has(resp.code)) {
          conflicts.push({ type: 'semantic', entity_id: op.rowId, detail: `Tarea rechazada: ${resp.code}` });
        } else throw e;
      } else throw e;
    }

    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    return conflicts;
  }
}
