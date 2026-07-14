import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { PaymentsView } from './PaymentsView';

/** Finanzas — pagos (F-4b): cobros/pagos imputados a facturas con saldo. */
export default async function PaymentsPage() {
  const [payments, invoices, banks] = await Promise.all([
    apiSafe<any[]>('/finance/payments'),
    apiSafe<any[]>('/finance/invoices'),
    apiSafe<any[]>('/finance/bank-accounts'),
  ]);
  if (payments === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Cobros y pagos imputados a facturas. El monto es la suma de las imputaciones.</p>
      </div>
      <FinanceNav />
      <PaymentsView payments={payments ?? []} invoices={invoices ?? []} banks={banks ?? []} />
    </div>
  );
}
