import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, EmptyState, KpiCard, TagMono } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { ReproCapture } from './ReproCapture';
import { HerdStatus } from './HerdStatus';
import { HeatsNotServedPanel } from './HeatsNotServedPanel';
import { ReproDashboard } from './ReproDashboard';

export default async function ReproPage() {
  const [kpis, bullsRes, lots] = await Promise.all([
    apiSafe<any>('/reproduction/kpis'),
    apiSafe<any>('/animals?category=toro&limit=50'),
    apiSafe<any[]>('/lots'),
  ]);
  if (!kpis) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reproducción</h1>
        <div className="flex items-center gap-4">
          <Link href="/reproduccion/reportes" className="text-label font-medium text-brand hover:underline">Reportes →</Link>
          <Link href="/reproduccion/protocolos" className="text-label font-medium text-brand hover:underline">Protocolos IATF →</Link>
        </div>
      </div>
      <p className="mt-0.5 mb-5 text-body text-ink-3">Celos, servicios, gestaciones, partos y destetes</p>

      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <KpiCard
          label="Preñez efectiva"
          value={kpis.pregnancy_rate_pct != null ? `${kpis.pregnancy_rate_pct}%` : '—'}
          hint={`${kpis.open_pregnancies} preñeces de ${kpis.breeding_females} vientres`}
          tone={kpis.pregnancy_rate_pct >= 60 ? 'success' : 'warning'}
        />
        <KpiCard label="Servicios (90 d)" value={kpis.services_90d} hint="montas e inseminaciones" />
        <KpiCard label="Partos (12 m)" value={kpis.calvings_12m} hint={`${kpis.calvings_due_30d} esperados en 30 días`} />
        <KpiCard
          label="Destetes (12 m)"
          value={kpis.weanings_12m.n}
          hint={kpis.weanings_12m.avg_weight_kg ? `${kpis.weanings_12m.avg_weight_kg} kg promedio` : 'sin datos de peso'}
        />
      </div>

      <ReproDashboard />

      <div className="mt-4 grid grid-cols-5 gap-4 max-lg:grid-cols-1">
        <div id="captura-repro" className="col-span-3 scroll-mt-4">
          <Card>
            <CardTitle>Captura rápida</CardTitle>
            <ReproCapture bulls={bullsRes?.data ?? []} />
          </Card>
        </div>
        <div className="col-span-2 self-start max-lg:col-span-5">
          <HeatsNotServedPanel />
        </div>
      </div>

      <div className="mt-4">
        <HerdStatus lots={lots ?? []} />
      </div>
    </div>
  );
}
