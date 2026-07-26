import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { InventoryManager } from './InventoryManager';
import { StockPanel } from './StockPanel';
import { RotationPanel, type RotationReport } from './RotationPanel';

/**
 * Inventario — maestro (INV-1): ítems, categorías y depósitos. Server Component para la carga;
 * las altas/bajas viven en InventoryManager. Sin movimientos/existencias (INV-2).
 */
export default async function InventoryPage() {
  const [units, categories, items, warehouses, stock, movements, batches, rotation] = await Promise.all([
    apiSafe<any[]>('/inventory/units'),
    apiSafe<any[]>('/inventory/categories'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
    apiSafe<any[]>('/inventory/stock'),
    apiSafe<any[]>('/inventory/movements'),
    apiSafe<any[]>('/inventory/batches'),
    // Rotación (Fase 4): el kardex decía cuánto hay; esto dice para cuántos días alcanza.
    apiSafe<RotationReport>('/inventory/rotation'),
  ]);
  if (items === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="mt-0.5 text-body text-ink-3">Para cuántos días alcanza cada insumo, qué plata está quieta, y el kardex completo.</p>
      </div>

      {rotation && (
        <section>
          <h2 className="mb-3 text-body font-semibold">Rotación</h2>
          <RotationPanel data={rotation} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-body font-semibold">Maestro</h2>
        <InventoryManager units={units ?? []} categories={categories ?? []} items={items ?? []} warehouses={warehouses ?? []} />
      </section>

      <section>
        <h2 className="mb-3 text-body font-semibold">Movimientos y existencias</h2>
        <StockPanel items={items ?? []} warehouses={warehouses ?? []} stock={stock ?? []} movements={movements ?? []} batches={batches ?? []} />
      </section>
    </div>
  );
}
