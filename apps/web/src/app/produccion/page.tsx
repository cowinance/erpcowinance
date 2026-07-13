import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ProduccionView } from './ProduccionView';

/**
 * Producción (P8-2.b): home visual del módulo — curva de peso, GDP por lote y distribución de
 * condición corporal, sobre `v_weighings` (regla única P8-1, incluye pesajes capturados en la
 * manga offline). Server Component para la carga inicial (período 12m, todos los lotes); los
 * filtros y el re-fetch viven en ProduccionView. Comparte endpoints con la pestaña de Reportes.
 */
const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86400000).toISOString().slice(0, 10);

export default async function ProduccionPage() {
  const from = monthsAgo(12);
  const to = today();
  const [lots, production, series, condition] = await Promise.all([
    apiSafe<any[]>('/lots'),
    apiSafe<any>(`/reports/production?from=${from}&to=${to}`),
    apiSafe<any>(`/reports/production-weight-series?from=${from}&to=${to}`),
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
        initial={{ from, to, production, series, condition }}
      />
    </div>
  );
}
