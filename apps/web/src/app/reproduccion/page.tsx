import Link from 'next/link';
import { apiSafe } from '@/lib/api';
import { Card, CardTitle, EmptyState, KpiCard, TagMono } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { ReproCapture } from './ReproCapture';
import { Baby } from 'lucide-react';

const DIAG_METHOD: Record<string, string> = { ultrasound: 'Ecografía', palpation: 'Palpación', blood: 'Sangre', visual: 'Visual' };

export default async function ReproPage() {
  const [kpis, upcoming, bullsRes] = await Promise.all([
    apiSafe<any>('/reproduction/kpis'),
    apiSafe<any[]>('/reproduction/upcoming-calvings?days=400'),
    apiSafe<any>('/animals?category=toro&limit=50'),
  ]);
  if (!kpis) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div>
      <h1 className="text-xl font-semibold">Reproducción</h1>
      <p className="mt-0.5 mb-5 text-[13px] text-ink-3">Celos, servicios, gestaciones, partos y destetes</p>

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

      <div className="mt-4 grid grid-cols-5 gap-4 max-lg:grid-cols-1">
        <Card className="col-span-3">
          <CardTitle action={<span className="text-[12px] text-ink-3">{(upcoming ?? []).length} preñeces abiertas</span>}>
            Próximos partos
          </CardTitle>
          {(upcoming ?? []).length === 0 ? (
            <p className="py-5 text-center text-[13px] text-ink-3">Sin preñeces abiertas.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Caravana</th>
                  <th>Nombre</th>
                  <th>Diagnóstico</th>
                  <th>Método</th>
                  <th className="text-right">Parto probable</th>
                  <th className="pr-1 text-right">Faltan</th>
                </tr>
              </thead>
              <tbody>
                {(upcoming ?? []).map((p: any) => (
                  <tr key={p.id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                    <td>
                      <Link href={`/animales/${p.animal_id}`} className="font-mono font-medium text-brand hover:underline">
                        {p.tag ?? '—'}
                      </Link>
                    </td>
                    <td className="text-ink-2">{p.name ?? '—'}</td>
                    <td className="text-ink-2">{formatDate(p.diagnosis_date)}</td>
                    <td className="text-ink-2">{DIAG_METHOD[p.method] ?? p.method ?? '—'}</td>
                    <td className="tnum text-right font-medium">{formatDate(p.expected_due_date)}</td>
                    <td className="pr-1 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${p.days_until <= 30 ? 'text-warning' : 'text-ink-2'}`}
                      >
                        <Baby size={12} /> {p.days_until} d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle>Captura rápida</CardTitle>
          <ReproCapture bulls={bullsRes?.data ?? []} />
        </Card>
      </div>
    </div>
  );
}
