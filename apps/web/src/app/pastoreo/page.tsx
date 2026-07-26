import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { PastoreoView } from './PastoreoView';
import { PaddockPerformance } from './PaddockPerformance';

/** Pastoreo (PG-2): entrada/salida de lotes por potrero + ocupación y descanso. */
export default async function PastoreoPage() {
  const [grazings, occupancy, paddocks, lots, performance] = await Promise.all([
    apiSafe<any[]>('/grazing'),
    apiSafe<any[]>('/grazing/occupancy'),
    apiSafe<any[]>('/paddocks'),
    apiSafe<any[]>('/lots'),
    // El cruce con Producción y Clima (Fase 3.2): qué potrero produce carne, y si fue el potrero
    // o fue el año.
    apiSafe<any>('/grazing/performance'),
  ]);
  if (grazings === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pastoreo</h1>
        <p className="mt-0.5 text-body text-ink-3">Rotación de lotes por potrero, y cuántos kilos produjo cada uno.</p>
      </div>
      {performance && <PaddockPerformance data={performance} />}
      <PastoreoView grazings={grazings ?? []} occupancy={occupancy ?? []} paddocks={paddocks ?? []} lots={lots ?? []} />
    </div>
  );
}
