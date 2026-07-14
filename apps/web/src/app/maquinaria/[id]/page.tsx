import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { MachineDetail } from './MachineDetail';

/** Detalle de una máquina (MQ-3): mantenimiento + combustible. */
export default async function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [machine, maintenance, fuel, items, warehouses, employees] = await Promise.all([
    apiSafe<any>(`/machinery/${id}`),
    apiSafe<any[]>(`/machinery/${id}/maintenance`),
    apiSafe<any[]>(`/machinery/${id}/fuel`),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
    apiSafe<any[]>('/hr/employees?active=true'),
  ]);
  if (machine === null) {
    return <EmptyState title="Máquina no encontrada" body="Volvé a Maquinaria y elegí una máquina." />;
  }
  return (
    <MachineDetail
      machine={machine}
      maintenance={maintenance ?? []}
      fuel={fuel ?? []}
      items={(items ?? []).filter((i) => i.is_active)}
      warehouses={warehouses ?? []}
      employees={employees ?? []}
    />
  );
}
