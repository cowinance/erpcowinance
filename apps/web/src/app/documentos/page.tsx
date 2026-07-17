import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { DocumentsView } from './DocumentsView';

/** Documentos y archivos (A6): DMS formal con vencimiento y alertas de caducidad. */
export default async function DocumentosPage() {
  const [docs, summary] = await Promise.all([apiSafe<any[]>('/documents'), apiSafe<any>('/documents/summary')]);
  if (docs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Documentos</h1>
        <p className="mt-0.5 text-body text-ink-3">Certificados, contratos, permisos e informes con seguimiento de vencimiento.</p>
      </div>
      <DocumentsView docs={docs ?? []} summary={summary ?? { total: 0, expired: 0, expiring_soon: 0 }} />
    </div>
  );
}
