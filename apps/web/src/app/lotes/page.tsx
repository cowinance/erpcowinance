import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { LotsManager } from './LotsManager';

/** Lotes / rodeos (B1): gestor completo — crear, editar, detalle con composición y archivar. */
export default async function LotsPage() {
  const [lots, paddocks] = await Promise.all([apiSafe<any[]>('/lots'), apiSafe<any[]>('/paddocks')]);
  if (!lots) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Lotes</h1>
        <p className="mt-0.5 text-body text-ink-3">Rodeos y grupos de manejo de la finca — creá, editá y seguí su composición.</p>
      </div>
      <LotsManager lots={lots ?? []} paddocks={(paddocks ?? []).map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
