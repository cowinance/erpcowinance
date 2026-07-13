import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { InventoryManager } from './InventoryManager';
import { StockPanel } from './StockPanel';

/**
 * Inventario — maestro (INV-1): ítems, categorías y depósitos. Server Component para la carga;
 * las altas/bajas viven en InventoryManager. Sin movimientos/existencias (INV-2).
 */
export default async function InventoryPage() {
  const [units, categories, items, warehouses, stock, movements] = await Promise.all([
    apiSafe<any[]>('/inventory/units'),
    apiSafe<any[]>('/inventory/categories'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
    apiSafe<any[]>('/inventory/stock'),
    apiSafe<any[]>('/inventory/movements'),
  ]);
  if (items === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="mt-0.5 text-body text-ink-3">Maestro de ítems/categorías/depósitos, movimientos y existencias.</p>
      </div>

      <section>
        <h2 className="mb-3 text-body font-semibold">Maestro</h2>
        <InventoryManager units={units ?? []} categories={categories ?? []} items={items ?? []} warehouses={warehouses ?? []} />
      </section>

      <section>
        <h2 className="mb-3 text-body font-semibold">Movimientos y existencias</h2>
        <StockPanel items={items ?? []} warehouses={warehouses ?? []} stock={stock ?? []} movements={movements ?? []} />
      </section>
    </div>
  );
}
