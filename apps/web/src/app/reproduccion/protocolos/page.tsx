import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ProtocolsManager } from './ProtocolsManager';
import { AssignmentsPanel } from './AssignmentsPanel';

/**
 * Protocolos reproductivos (R-2.a/b): tres secciones separadas — plantillas (definiciones
 * reusables), asignación a un lote (instancias ejecutables que generan tareas) y el calendario
 * previsto. Server Component para la carga; las mutaciones viven en las islas cliente.
 */
export default async function ProtocolsPage() {
  const [protocols, lots, assignments] = await Promise.all([
    apiSafe<any[]>('/reproduction/protocols'),
    apiSafe<any[]>('/lots'),
    apiSafe<any[]>('/reproduction/protocol-assignments'),
  ]);
  if (protocols === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Protocolos reproductivos</h1>
        <p className="mt-0.5 text-body text-ink-3">Plantillas de sincronización (IATF), su asignación a un lote y el calendario previsto.</p>
      </div>

      <section>
        <h2 className="text-body font-semibold">Plantillas de protocolos</h2>
        <p className="mb-3 mt-0.5 text-label text-ink-3">Definiciones reusables. Editar una plantilla NO modifica asignaciones ya creadas.</p>
        <ProtocolsManager initial={protocols} />
      </section>

      <section>
        <h2 className="text-body font-semibold">Asignar protocolo y asignaciones activas</h2>
        <p className="mb-3 mt-0.5 text-label text-ink-3">Una asignación aplica una plantilla a un lote desde una fecha y genera las tareas del protocolo.</p>
        <AssignmentsPanel protocols={protocols} lots={lots ?? []} assignments={assignments ?? []} />
      </section>
    </div>
  );
}
