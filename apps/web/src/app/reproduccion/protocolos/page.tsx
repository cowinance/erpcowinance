import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ProtocolsManager } from './ProtocolsManager';

/**
 * Protocolos reproductivos (R-2.a): administración de plantillas de sincronización (IATF) — pasos
 * temporizados desde el día 0. Server Component para la carga; la edición vive en ProtocolsManager.
 * La asignación a un grupo y el calendario/tareas son R-2.b (aún no).
 */
export default async function ProtocolsPage() {
  const protocols = await apiSafe<any[]>('/reproduction/protocols');
  if (protocols === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Protocolos reproductivos</h1>
        <p className="mt-0.5 text-body text-ink-3">Plantillas de sincronización (IATF): pasos temporizados desde el día 0.</p>
      </div>
      <ProtocolsManager initial={protocols} />
    </div>
  );
}
