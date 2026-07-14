import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { TraceabilityNav } from '../TraceabilityNav';
import { CertificationsManager } from './CertificationsManager';

/** Trazabilidad — certificaciones (T-3): por animal/lote, con esquema, vigencia y estado. */
export default async function CertificationsPage() {
  const [certs, animalsRes, lots] = await Promise.all([
    apiSafe<any[]>('/traceability/certifications'),
    apiSafe<{ data: any[] }>('/animals?status=active'),
    apiSafe<any[]>('/lots'),
  ]);
  if (certs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trazabilidad</h1>
        <p className="mt-0.5 text-body text-ink-3">Certificaciones por animal o lote (esquema, emisor, vigencia).</p>
      </div>
      <TraceabilityNav />
      <CertificationsManager certs={certs ?? []} animals={animalsRes?.data ?? []} lots={lots ?? []} />
    </div>
  );
}
