import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { TreasuryView } from './TreasuryView';

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86400000).toISOString().slice(0, 10);

/** Finanzas — Tesorería (G3): liquidez por cuenta, flujo de caja, aging de CxC/CxP y días de cobro/pago. */
export default async function TreasuryPage() {
  const from = monthsAgo(12);
  const to = today();
  const summary = await apiSafe<any>(`/treasury/summary?from=${from}&to=${to}`);
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Tesorería: liquidez, flujo de caja y antigüedad de saldos por cobrar y por pagar.</p>
      </div>
      <FinanceNav />
      <TreasuryView initial={summary} from={from} to={to} />
    </div>
  );
}
