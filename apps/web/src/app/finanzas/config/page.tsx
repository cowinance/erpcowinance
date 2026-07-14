import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { ConfigView } from './ConfigView';

/** Finanzas — configuración (F-4b): mapa rol→cuenta de posteo + cuentas bancarias. */
export default async function FinanceConfigPage() {
  const [accounts, map, banks] = await Promise.all([
    apiSafe<any[]>('/finance/accounts'),
    apiSafe<Record<string, string>>('/finance/posting-accounts'),
    apiSafe<any[]>('/finance/bank-accounts'),
  ]);
  if (accounts === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Mapa de cuentas para los asientos automáticos y cuentas bancarias.</p>
      </div>
      <FinanceNav />
      <ConfigView accounts={(accounts ?? []).filter((a) => a.is_postable)} map={map ?? {}} banks={banks ?? []} />
    </div>
  );
}
