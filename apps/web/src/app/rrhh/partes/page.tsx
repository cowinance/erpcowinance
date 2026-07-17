import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { RrhhNav } from '../RrhhNav';
import { WorkLogsView } from './WorkLogsView';

/** RRHH — partes de trabajo (WL-1): registrar horas por empleado + resumen por período. */
export default async function WorkLogsPage() {
  const [logs, summary, employees, tasks, farms] = await Promise.all([
    apiSafe<any[]>('/hr/work-logs'),
    apiSafe<any[]>('/hr/work-logs/summary'),
    apiSafe<any[]>('/hr/employees?active=true'),
    apiSafe<any[]>('/tasks'),
    apiSafe<any[]>('/farms'),
  ]);
  if (logs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Personal</h1>
        <p className="mt-0.5 text-body text-ink-3">Partes de trabajo: horas por empleado, imputadas a una tarea o finca.</p>
      </div>
      <RrhhNav />
      <WorkLogsView logs={logs ?? []} summary={summary ?? []} employees={employees ?? []} tasks={tasks ?? []} farms={farms ?? []} />
    </div>
  );
}
