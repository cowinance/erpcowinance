import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CropDetail } from './CropDetail';

/** Detalle de un cultivo (AG-3): labores (consumen insumos) + cosechas (rinde). */
export default async function CropDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [crop, operations, harvests, items, warehouses, employees] = await Promise.all([
    apiSafe<any>(`/agriculture/crops/${id}`),
    apiSafe<any[]>(`/agriculture/crops/${id}/operations`),
    apiSafe<any[]>(`/agriculture/crops/${id}/harvests`),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
    apiSafe<any[]>('/hr/employees?active=true'),
  ]);
  if (crop === null) {
    return <EmptyState title="Cultivo no encontrado" body="Volvé a Agricultura y elegí un cultivo." />;
  }
  return (
    <CropDetail
      crop={crop}
      operations={operations ?? []}
      harvests={harvests ?? []}
      items={(items ?? []).filter((i) => i.is_active)}
      warehouses={warehouses ?? []}
      employees={employees ?? []}
    />
  );
}
