import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { TraceabilityNav } from './TraceabilityNav';
import { GuidesManager } from './GuidesManager';

/** Trazabilidad — guías de traslado (T-3): documento origen→destino con estados. */
export default async function TraceabilityPage() {
  const [guides, partners] = await Promise.all([apiSafe<any[]>('/traceability/guides'), apiSafe<any[]>('/commerce/partners')]);
  if (guides === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trazabilidad</h1>
        <p className="mt-0.5 text-body text-ink-3">Guías de traslado de hacienda (origen finca → destino socio).</p>
      </div>
      <TraceabilityNav />
      <GuidesManager guides={guides ?? []} partners={partners ?? []} />
    </div>
  );
}
