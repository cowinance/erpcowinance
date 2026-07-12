import { apiSafe } from '@/lib/server-api';
import { TasksBoard } from './TasksBoard';

/**
 * Tareas (P6-2.b): lista de tareas de la finca con crear/completar/cancelar online por
 * REST. Server Component que carga las tareas; la interacción vive en TasksBoard (cliente).
 */
export default async function TareasPage() {
  const tasks = (await apiSafe<any[]>('/tasks')) ?? [];
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Tareas</h1>
        <p className="mt-0.5 text-body text-ink-3">Trabajo de la finca — creá, completá y cancelá tareas.</p>
      </div>
      <TasksBoard initialTasks={tasks} />
    </div>
  );
}
