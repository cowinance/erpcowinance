import { TasksBoard } from './TasksBoard';

/**
 * Tareas (mejora a centro operativo, E2): tablero operativo diario. La primera pantalla es la
 * agenda — KPIs, buckets (hoy/vencidas/próximas/mes/sin-fecha/completadas/canceladas), filtros
 * y acciones rápidas. El cliente hace read-through de /tasks/board + /tasks/kpis (online, REST).
 */
export default function TareasPage() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Tareas</h1>
        <p className="mt-0.5 text-body text-ink-3">Qué hacer hoy, qué está vencido y qué viene — con responsable y animal/lote.</p>
      </div>
      <TasksBoard />
    </div>
  );
}
