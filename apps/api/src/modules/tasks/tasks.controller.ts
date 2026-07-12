import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TaskService, TaskType } from './task.service';

/** Tipos de tarea que el endpoint general acepta — `health` queda reservado a Sanidad. */
const GENERAL_TYPES = new Set<TaskType>(['general', 'breeding', 'feeding', 'maintenance', 'crop']);

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
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

  /** Lista mínima (verificación + P6-2). */
  @Get('tasks')
  list(@Query('status') status?: string) {
    return this.tasks.list(status);
  }
}
