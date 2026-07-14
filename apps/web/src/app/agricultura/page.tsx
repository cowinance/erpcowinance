import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CropsManager } from './CropsManager';

/** Agricultura — cultivos (AG-3): alta sobre un paddock + estados; cada cultivo abre su detalle. */
export default async function AgriculturePage() {
  const [crops, paddocks] = await Promise.all([apiSafe<any[]>('/agriculture/crops'), apiSafe<any[]>('/paddocks')]);
  if (crops === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Agricultura</h1>
        <p className="mt-0.5 text-body text-ink-3">Cultivos por potrero. Entrá a un cultivo para registrar labores y cosechas.</p>
      </div>
      <CropsManager crops={crops ?? []} paddocks={paddocks ?? []} />
    </div>
  );
}
