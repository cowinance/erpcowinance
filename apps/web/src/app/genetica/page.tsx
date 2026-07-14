import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from './GeneticsNav';
import { SemenManager } from './SemenManager';

/** Genética — semen (G-3): partidas de pajuelas con saldo. */
export default async function GeneticsPage() {
  const [batches, animalsRes] = await Promise.all([apiSafe<any[]>('/genetics/semen'), apiSafe<{ data: any[] }>('/animals?status=active')]);
  if (batches === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const animals = animalsRes?.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Partidas de semen (pajuelas). El saldo se ajusta con +/− (una inseminación lo descuenta).</p>
      </div>
      <GeneticsNav />
      <SemenManager batches={batches ?? []} animals={animals.filter((a: any) => a.sex === 'M')} />
    </div>
  );
}
