import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { NutritionNav } from '../NutritionNav';
import { DeliveriesView } from './DeliveriesView';

/** Nutrición — entregas (N-3): entregar una ración a un lote descuenta stock (N-2). */
export default async function DeliveriesPage() {
  const [deliveries, rations, lots, warehouses] = await Promise.all([
    apiSafe<any[]>('/nutrition/feed-deliveries'),
    apiSafe<any[]>('/nutrition/rations'),
    apiSafe<any[]>('/lots'),
    apiSafe<any[]>('/inventory/warehouses'),
  ]);
  if (deliveries === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Nutrición</h1>
        <p className="mt-0.5 text-body text-ink-3">Entregas de alimento a lote. Al entregar se descuenta el stock de los ingredientes.</p>
      </div>
      <NutritionNav />
      <DeliveriesView deliveries={deliveries ?? []} rations={(rations ?? []).filter((r) => r.is_active)} lots={lots ?? []} warehouses={warehouses ?? []} />
    </div>
  );
}
