import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { MachineryManager } from './MachineryManager';

/** Maquinaria — máquinas (MQ-3): maestro con estados; cada máquina abre su detalle. */
export default async function MachineryPage() {
  const machines = await apiSafe<any[]>('/machinery');
  if (machines === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Maquinaria</h1>
        <p className="mt-0.5 text-body text-ink-3">Máquinas de la finca. Entrá a una máquina para registrar mantenimiento y combustible.</p>
      </div>
      <MachineryManager machines={machines ?? []} />
    </div>
  );
}
