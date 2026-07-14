import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { JournalView } from './JournalView';

/** Finanzas — libro diario (F-4a): asientos manuales balanceados + reversa. */
export default async function JournalPage() {
  const [journal, accounts] = await Promise.all([apiSafe<any[]>('/finance/journal'), apiSafe<any[]>('/finance/accounts')]);
  if (journal === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const postable = (accounts ?? []).filter((a) => a.is_postable);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Asientos de partida doble. Se crean posteados y balanceados; corregir = reversa.</p>
      </div>
      <FinanceNav />
      <JournalView journal={journal ?? []} accounts={postable} />
    </div>
  );
}
