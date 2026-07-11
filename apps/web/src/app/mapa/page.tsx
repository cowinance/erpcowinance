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

  const withGeometry = paddocks.filter((p) => p.boundary?.coordinates?.length);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Potreros y Mapa</h1>
        <p className="mt-0.5 text-body text-ink-3">
          {farms?.[0]?.name ?? 'Finca'} · {paddocks.length} potreros ·{' '}
          {paddocks.reduce((s, p) => s + (p.area_ha ?? 0), 0).toLocaleString('es-AR')} ha · mapa esquemático (el
          dibujo sobre cartografía real llega en Fase 2)
        </p>
      </div>

      {withGeometry.length === 0 ? (
        <EmptyState
          title="Sin potreros dibujados todavía"
          body="Los potreros de esta finca no tienen geometría cargada. El editor de dibujo con snapping sobre tiles vectoriales llega con el módulo completo de Mapas (Fase 2)."
        />
      ) : (
        <FarmMap paddocks={paddocks} lots={lots ?? []} />
      )}
    </div>
  );
}
