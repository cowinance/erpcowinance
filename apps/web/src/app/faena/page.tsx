import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FaenaView } from './FaenaView';

/** Faena (FA-2): registrar reses (rendimiento derivado del peso vivo) + análisis por lote/padre. */
export default async function FaenaPage() {
  const [carcasses, animalsRes, byLot, bySire] = await Promise.all([
    apiSafe<any[]>('/slaughter/carcasses'),
    apiSafe<{ data: any[] }>('/animals?status=sold'),
    apiSafe<any[]>('/slaughter/analytics?by=lot'),
    apiSafe<any[]>('/slaughter/analytics?by=sire'),
  ]);
  if (carcasses === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Faena</h1>
        <p className="mt-0.5 text-body text-ink-3">El rendimiento se deriva del último peso vivo. Análisis por lote y por padre.</p>
      </div>
      <FaenaView carcasses={carcasses ?? []} animals={animalsRes?.data ?? []} byLot={byLot ?? []} bySire={bySire ?? []} />
    </div>
  );
}
