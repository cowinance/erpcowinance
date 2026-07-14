import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { TrialBalanceView } from './TrialBalanceView';

/** Finanzas — sumas y saldos (F-4a): balance por cuenta, derivado del libro diario. */
export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { from, to } = await searchParams;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const rows = await apiSafe<any[]>(`/finance/trial-balance${qs.toString() ? `?${qs}` : ''}`);
  if (rows === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Sumas y saldos por cuenta (asientos posteados).</p>
      </div>
      <FinanceNav />
      <TrialBalanceView rows={rows ?? []} from={from ?? ''} to={to ?? ''} />
    </div>
  );
}
