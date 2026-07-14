import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { InvoicesView } from './InvoicesView';

/** Finanzas — facturas (F-4b): emitir desde venta/compra, contabilizar el documento (F-2), anular. */
export default async function InvoicesPage() {
  const [invoices, sales, purchases] = await Promise.all([
    apiSafe<any[]>('/finance/invoices'),
    apiSafe<any[]>('/commerce/sales'),
    apiSafe<any[]>('/commerce/purchases'),
  ]);
  if (invoices === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Facturas emitidas y recibidas. Contabilizá el documento y luego facturá.</p>
      </div>
      <FinanceNav />
      <InvoicesView invoices={invoices ?? []} sales={sales ?? []} purchases={purchases ?? []} />
    </div>
  );
}
