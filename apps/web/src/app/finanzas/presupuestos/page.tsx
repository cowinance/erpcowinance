import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { BudgetsView } from './BudgetsView';

/** Finanzas — presupuestos (BG-3): editor de líneas (cuenta × mes) + comparativo contra el real. */
export default async function BudgetsPage() {
  const [budgets, accounts, costCenters] = await Promise.all([
    apiSafe<any[]>('/finance/budgets'),
    apiSafe<any[]>('/finance/accounts'),
    apiSafe<any[]>('/finance/cost-centers'),
  ]);
  if (budgets === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Presupuesto por cuenta y mes, comparado contra los asientos del mayor.</p>
      </div>
      <FinanceNav />
      <BudgetsView budgets={budgets ?? []} accounts={(accounts ?? []).filter((a) => a.is_postable)} costCenters={costCenters ?? []} />
    </div>
  );
}
