import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FiscalView } from './FiscalView';

/**
 * Facturación (G4) — configuración fiscal y libro de ventas.
 *
 * Es la pantalla que faltaba: las series de numeración y las alícuotas son configuración del
 * productor y hasta acá solo se cargaban por API. Todo en USD, sin conversión.
 */
export default async function FacturacionPage() {
  const [series, rates, documents] = await Promise.all([
    apiSafe<any[]>('/tax/series'),
    apiSafe<any>('/tax/vat-rates'),
    apiSafe<any[]>('/tax/documents'),
  ]);
  if (series === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Facturación</h1>
        <p className="mt-0.5 text-body text-ink-3">Series fiscales, alícuotas de IVA y libro de ventas. Todo en dólares.</p>
      </div>
      <FiscalView series={series ?? []} rates={rates ?? {}} documents={documents ?? []} />
    </div>
  );
}
