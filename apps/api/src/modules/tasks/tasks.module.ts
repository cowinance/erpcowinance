import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TaskService } from './task.service';

/**
 * Tareas (P6): bounded context propio. `TaskService` es la fuente única del CÓMO se crea y
 * cambia de estado cualquier tarea; se exporta para que Sanidad (que decide QUÉ tarea
 * clínica debe existir) y —en P6-1.b— el TaskSyncHandler lo reutilicen sin duplicar reglas.
 */
@Module({
  controllers: [TasksController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TasksModule {}
