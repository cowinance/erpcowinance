import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from './FinanceNav';
import { AccountsManager } from './AccountsManager';

/** Finanzas — plan de cuentas + períodos + centros de costo (F-4a). Server Component para la carga. */
export default async function FinancePage() {
  const [accounts, periods, costCenters] = await Promise.all([
    apiSafe<any[]>('/finance/accounts'),
    apiSafe<any[]>('/finance/periods'),
    apiSafe<any[]>('/finance/cost-centers'),
  ]);
  if (accounts === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Plan de cuentas, períodos fiscales y centros de costo.</p>
      </div>
      <FinanceNav />
      <AccountsManager accounts={accounts ?? []} periods={periods ?? []} costCenters={costCenters ?? []} />
    </div>
  );
}
