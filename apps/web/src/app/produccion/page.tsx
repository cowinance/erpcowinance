import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ProduccionView } from './ProduccionView';

/**
 * Producción (P8-2.b): home visual del módulo — curva de peso, GDP por lote y distribución de
 * condición corporal, sobre `v_weighings` (regla única P8-1, incluye pesajes capturados en la
 * manga offline). Server Component para la carga inicial (período 12m, todos los lotes); los
 * filtros y el re-fetch viven en ProduccionView. Comparte endpoints con la pestaña de Reportes.
 */
// El rango por defecto lo decide la API, que sabe en qué zona empieza el día de la finca; acá se
// lee el que efectivamente usó (viene en la respuesta). Calcularlo en el servidor web daba la fecha
// de ESA máquina —UTC en producción—, así que después de las 20:00 el período arrancaba un día
// adelantado.

export default async function ProduccionPage() {
  const [lots, production, series, condition] = await Promise.all([
    apiSafe<any[]>('/lots'),
    apiSafe<any>('/reports/production'),
    apiSafe<any>('/reports/production-weight-series'),
    apiSafe<any>('/reports/condition-distribution'),
  ]);

  if (!production && !series && !condition) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Producción</h1>
        <p className="mt-0.5 text-body text-ink-3">Curva de peso, ganancia diaria (GDP) por lote y condición corporal.</p>
      </div>
      <ProduccionView
        lots={lots ?? []}
        initial={{ from: production?.from, to: production?.to, production, series, condition }}
      />
    </div>
  );
}
