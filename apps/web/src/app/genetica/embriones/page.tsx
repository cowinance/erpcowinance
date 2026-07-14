import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { EmbryosManager } from './EmbryosManager';

/** Genética — embriones (G-3): inventario con saldo (una transferencia lo descuenta). */
export default async function EmbryosPage() {
  const [embryos, animalsRes] = await Promise.all([apiSafe<any[]>('/genetics/embryos'), apiSafe<{ data: any[] }>('/animals?status=active')]);
  if (embryos === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const animals = animalsRes?.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Embriones. El saldo se ajusta con +/− (una transferencia embrionaria lo descuenta).</p>
      </div>
      <GeneticsNav />
      <EmbryosManager embryos={embryos ?? []} animals={animals.filter((a: any) => a.sex === 'F')} />
    </div>
  );
}
