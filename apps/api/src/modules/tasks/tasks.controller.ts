import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TaskService, TaskType } from './task.service';
import { TaskRulesService } from './task-rules.service';

/** Tipos de tarea que el endpoint general acepta — `health` queda reservado a Sanidad. */
const GENERAL_TYPES = new Set<TaskType>(['general', 'breeding', 'feeding', 'maintenance', 'crop']);

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly rules: TaskRulesService,
    private readonly db: DbService,
  ) {}

  /** Crea una tarea general de finca (server-authored → server-origin). */
  @Post('tasks')
  create(@Body() body: any) {
    const type: TaskType = body?.type ?? 'general';
    if (!GENERAL_TYPES.has(type))
      throw new BadRequestException({ code: 'task.type_invalid', title: 'Las tareas de salud se generan desde Sanidad' });
    return this.db
      .tx((q) =>
        this.tasks.createTask(
          q,
          {
            title: body?.title,
            description: body?.description ?? null,
            type,
            dueDate: body?.due_date ?? null,
            priority: body?.priority ?? 'normal',
            relatedType: body?.related_type ?? null,
            relatedId: body?.related_id ?? null,
          },
          { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user },
        ),
      )
      .then((r) => ({ id: r.taskId }));
  }

  /** Completa una tarea (server-authored → server-origin). Hora del servidor. */
  @Post('tasks/:id/complete')
  complete(@Param('id') id: string) {
    return this.db
      .tx((q) => this.tasks.completeTask(q, { taskId: id }, { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user }))
      .then((r) => ({ id, status: r.status }));
  }

  /** Cancela una tarea (server-authored → server-origin). Motivo opcional. */
  @Post('tasks/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: any) {
    return this.db
      .tx((q) => this.tasks.cancelTask(q, { taskId: id, reason: body?.reason ?? null }, { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user }))
      .then((r) => ({ id, status: r.status }));
  }

  /** Inicia una tarea: pending → in_progress (server-authored → server-origin). */
  @Post('tasks/:id/start')
  start(@Param('id') id: string) {
    return this.db
      .tx((q) => this.tasks.startTask(q, { taskId: id }, { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user }))
      .then((r) => ({ id, status: r.status }));
  }

  /** Reprograma una tarea: cambia due_date con motivo opcional (server-authored → server-origin). */
  @Post('tasks/:id/reschedule')
  reschedule(@Param('id') id: string, @Body() body: any) {
    return this.db
      .tx((q) =>
        this.tasks.rescheduleTask(
          q,
          { taskId: id, dueDate: body?.due_date ?? null, reason: body?.reason ?? null },
          { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user },
        ),
      )
      .then((r) => ({ id, changed: r.changed }));
  }

  /** Asigna/reasigna la tarea a un usuario (null = desasignar). server-authored → server-origin. */
  @Post('tasks/:id/assign')
  assign(@Param('id') id: string, @Body() body: any) {
    return this.db
      .tx((q) =>
        this.tasks.assignTask(q, { taskId: id, assignedTo: body?.assigned_to ?? null }, { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user }),
      )
      .then((r) => ({ id, changed: r.changed }));
  }

  /** Lista mínima (verificación + P6-2). */
  @Get('tasks')
  list(@Query('status') status?: string) {
    return this.tasks.list(status);
  }

  /** Tablero operativo enriquecido (E2): joins + bucket + días de atraso + filtros. */
  @Get('tasks/board')
  board(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assigned_to') assignedTo?: string,
    @Query('type') type?: string,
    @Query('bucket') bucket?: string,
    @Query('related_type') relatedType?: string,
    @Query('related_id') relatedId?: string,
    @Query('q') q?: string,
  ) {
    return this.tasks.board({ status, priority, assignedTo, type, bucket, relatedType, relatedId, q });
  }

  /** KPIs del tablero (E2). */
  @Get('tasks/kpis')
  kpis() {
    return this.tasks.kpis();
  }

  /** Usuarios asignables como responsables (E2). */
  @Get('tasks/assignees')
  assignees() {
    return this.tasks.assignees();
  }

  /** Materializa las reglas ganaderas automáticas por condición (E4). Deduplica por rule_key. */
  @Post('tasks/materialize')
  materialize(@Body() body: any) {
    return this.rules.materialize({ weighDays: body?.weigh_days, lotReviewDays: body?.lot_review_days });
  }

  /** Recurrencias (E5): crear plantilla / listar / desactivar. Rutas estáticas (antes de :id). */
  @Post('tasks/recurrences')
  createRecurrence(@Body() body: any) {
    return this.rules.createRecurrence(body);
  }

  @Get('tasks/recurrences')
  listRecurrences() {
    return this.rules.listRecurrences();
  }

  @Post('tasks/recurrences/:id/deactivate')
  deactivateRecurrence(@Param('id') id: string) {
    return this.rules.deactivateRecurrence(id);
  }

  /** Acción masiva sobre varias tareas (E3). Debe ir ANTES de la ruta paramétrica. */
  @Post('tasks/bulk')
  bulk(@Body() body: any) {
    return this.tasks.bulk(
      { ids: body?.ids ?? [], action: body?.action, dueDate: body?.due_date ?? null, reason: body?.reason ?? null, assignedTo: body?.assigned_to ?? null, priority: body?.priority },
      { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user },
    );
  }

  /** Cambia la prioridad (E3, server-authored → server-origin). */
  @Post('tasks/:id/priority')
  priority(@Param('id') id: string, @Body() body: any) {
    return this.db
      .tx((q) => this.tasks.setPriority(q, { taskId: id, priority: body?.priority }, { origin: 'rest', emitServerOrigin: true, actorUserId: this.db.user }))
      .then((r) => ({ id, changed: r.changed }));
  }

  /** Agrega un comentario/nota a la tarea (E3). */
  @Post('tasks/:id/comment')
  comment(@Param('id') id: string, @Body() body: any) {
    return this.db
      .tx((q) => this.tasks.addComment(q, { taskId: id, text: body?.text }, { origin: 'rest', emitServerOrigin: false, actorUserId: this.db.user }))
      .then(() => ({ id, ok: true }));
  }

  /** Detalle de una tarea (E3): datos completos + relacionado + responsable + historial. */
  @Get('tasks/:id')
  detail(@Param('id') id: string) {
    return this.tasks.detail(id);
  }
}
