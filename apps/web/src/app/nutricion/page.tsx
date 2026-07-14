import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { NutritionNav } from './NutritionNav';
import { RationsManager } from './RationsManager';

/** Nutrición — raciones (N-3): fórmula + editor de ingredientes (% de ítems de Inventario). */
export default async function NutritionPage() {
  const [rations, items] = await Promise.all([apiSafe<any[]>('/nutrition/rations'), apiSafe<any[]>('/inventory/items')]);
  if (rations === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Nutrición</h1>
        <p className="mt-0.5 text-body text-ink-3">Raciones y su composición (los porcentajes deben sumar 100%).</p>
      </div>
      <NutritionNav />
      <RationsManager rations={rations ?? []} items={(items ?? []).filter((i) => i.is_active)} />
    </div>
  );
}
