import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { MachineryManager } from './MachineryManager';
import { MachineryCosts, type MachineryCostReport } from './MachineryCosts';

/** Maquinaria — máquinas (MQ-3): maestro con estados; cada máquina abre su detalle. */
export default async function MachineryPage() {
  const [machines, costs] = await Promise.all([
    apiSafe<any[]>('/machinery'),
    // Lo que cuesta usarlas (Fase 4): el módulo registraba gasto y no contestaba cuánto sale la hora.
    apiSafe<MachineryCostReport>('/machinery/costs'),
  ]);
  if (machines === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Maquinaria</h1>
        <p className="mt-0.5 text-body text-ink-3">Máquinas de la finca, y cuánto cuesta usar cada una.</p>
      </div>
      {costs && <MachineryCosts data={costs} />}
      <MachineryManager machines={machines ?? []} />
    </div>
  );
}
