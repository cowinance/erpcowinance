import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FarmMap } from './FarmMap';

export default async function MapaPage() {
  const [paddocks, lots, farms] = await Promise.all([
    apiSafe<any[]>('/paddocks'),
    apiSafe<any[]>('/lots'),
    apiSafe<any[]>('/farms'),
  ]);
  if (!paddocks) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Potreros y Mapa</h1>
        <p className="mt-0.5 text-body text-ink-3">
          {farms?.[0]?.name ?? 'Finca'} · {paddocks.length} potreros ·{' '}
          {paddocks.reduce((s, p) => s + (p.area_ha ?? 0), 0).toLocaleString('es-AR')} ha · dibujá y editá potreros
          sobre el mapa (en producción, sobre cartografía real)
        </p>
      </div>

      <FarmMap paddocks={paddocks} lots={lots ?? []} />
    </div>
  );
}
