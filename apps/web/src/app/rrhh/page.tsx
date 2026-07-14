import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { RrhhNav } from './RrhhNav';
import { EmployeesManager } from './EmployeesManager';

/** RRHH — empleados (H-3): maestro con altas, edición y terminación/reactivación. */
export default async function RrhhPage() {
  const employees = await apiSafe<any[]>('/hr/employees');
  if (employees === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Personal</h1>
        <p className="mt-0.5 text-body text-ink-3">Empleados de la empresa. Las liquidaciones se hacen sobre este maestro.</p>
      </div>
      <RrhhNav />
      <EmployeesManager employees={employees ?? []} />
    </div>
  );
}
