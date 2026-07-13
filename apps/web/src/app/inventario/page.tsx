import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { InventoryManager } from './InventoryManager';

/**
 * Inventario — maestro (INV-1): ítems, categorías y depósitos. Server Component para la carga;
 * las altas/bajas viven en InventoryManager. Sin movimientos/existencias (INV-2).
 */
export default async function InventoryPage() {
  const [units, categories, items, warehouses] = await Promise.all([
    apiSafe<any[]>('/inventory/units'),
    apiSafe<any[]>('/inventory/categories'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
  ]);
  if (items === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="mt-0.5 text-body text-ink-3">Maestro de ítems, categorías y depósitos. (Movimientos y existencias, próximamente.)</p>
      </div>
      <InventoryManager units={units ?? []} categories={categories ?? []} items={items ?? []} warehouses={warehouses ?? []} />
    </div>
  );
}
