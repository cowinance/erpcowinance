import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CropsManager } from './CropsManager';
import { CropYields, type CropYieldReport } from './CropYields';

/** Agricultura — cultivos (AG-3): alta sobre un paddock + estados; cada cultivo abre su detalle. */
export default async function AgriculturePage() {
  const [crops, paddocks, yields] = await Promise.all([
    apiSafe<any[]>('/agriculture/crops'),
    apiSafe<any[]>('/paddocks'),
    // Rinde y costo por hectárea (Fase 4): el módulo registraba labores y no cerraba la campaña.
    apiSafe<CropYieldReport>('/agriculture/crops/yields'),
  ]);
  if (crops === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Agricultura</h1>
        <p className="mt-0.5 text-body text-ink-3">Cuánto rindió cada lote, cuánto costó la hectárea, y cómo se compara con los del mismo cultivo.</p>
      </div>
      {yields && <CropYields data={yields} />}
      <CropsManager crops={crops ?? []} paddocks={paddocks ?? []} />
    </div>
  );
}
