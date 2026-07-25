import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ClimaView } from './ClimaView';

/**
 * Clima y agrometeorología (D4). Muestra los cuatro indicadores del catálogo —lluvia acumulada,
 * grados-día, estrés calórico y balance hídrico— derivados de la serie de la estación.
 */
export default async function ClimaPage() {
  const [summary, stations] = await Promise.all([
    apiSafe<any>('/weather/summary?gdd_base=10'),
    apiSafe<any[]>('/weather/stations'),
  ]);
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Clima</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Últimos 30 días. Los índices se calculan sobre las mediciones cargadas: si un día no se midió, no cuenta
          como cero.
        </p>
      </div>
      <ClimaView summary={summary} stations={stations ?? []} />
    </div>
  );
}
