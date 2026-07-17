import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { BreedingView } from './BreedingView';

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86400000).toISOString().slice(0, 10);

/** Cría y recría (C3): panel de eficiencia del rodeo de cría (destete/entore, kg/ha, reposición). */
export default async function CriaPage() {
  const from = monthsAgo(12);
  const to = today();
  const summary = await apiSafe<any>(`/breeding/summary?from=${from}&to=${to}`);
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Cría y recría</h1>
        <p className="mt-0.5 text-body text-ink-3">Eficiencia del rodeo de cría: destete por vientre, kilos destetados por hectárea y reposición.</p>
      </div>
      <BreedingView initial={summary} from={from} to={to} />
    </div>
  );
}
