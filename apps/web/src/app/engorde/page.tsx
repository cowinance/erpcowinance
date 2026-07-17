import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FeedlotView } from './FeedlotView';

/** Engorde y feedlot (C2): panel de corrales (lotes de engorde) con KPIs derivados. */
export default async function FeedlotPage() {
  const lots = await apiSafe<any[]>('/feedlot/lots');
  if (lots === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Engorde a corral</h1>
        <p className="mt-0.5 text-body text-ink-3">Conversión, costo del kilo ganado y proyección de terminación por corral.</p>
      </div>
      <FeedlotView initial={lots ?? []} />
    </div>
  );
}
