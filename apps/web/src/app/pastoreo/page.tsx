import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { PastoreoView } from './PastoreoView';

/** Pastoreo (PG-2): entrada/salida de lotes por potrero + ocupación y descanso. */
export default async function PastoreoPage() {
  const [grazings, occupancy, paddocks, lots] = await Promise.all([
    apiSafe<any[]>('/grazing'),
    apiSafe<any[]>('/grazing/occupancy'),
    apiSafe<any[]>('/paddocks'),
    apiSafe<any[]>('/lots'),
  ]);
  if (grazings === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pastoreo</h1>
        <p className="mt-0.5 text-body text-ink-3">Rotación de lotes por potrero. Un lote pastorea un potrero por vez.</p>
      </div>
      <PastoreoView grazings={grazings ?? []} occupancy={occupancy ?? []} paddocks={paddocks ?? []} lots={lots ?? []} />
    </div>
  );
}
