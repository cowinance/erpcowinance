import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, EmptyState, KpiCard, TagMono } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { SanidadCapture } from './SanidadCapture';
import { HealthPlansPanel } from './HealthPlansPanel';
import { MedicationsPanel } from './MedicationsPanel';
import { Clock, Syringe } from 'lucide-react';

export default async function SanidadPage() {
  const [kpis, withdrawals, upcoming, products, lots, categories] = await Promise.all([
    apiSafe<any>('/health/kpis'),
    apiSafe<any[]>('/health/withdrawals'),
    apiSafe<any[]>('/health/upcoming-vaccinations?days=60'),
    apiSafe<any[]>('/products-veterinary'),
    apiSafe<any[]>('/lots'),
    apiSafe<any[]>('/catalogs/categories'),
  ]);
  if (!kpis) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div>
      <h1 className="text-xl font-semibold">Sanidad</h1>
      <p className="mt-0.5 mb-5 text-body text-ink-3">Vacunaciones, tratamientos, retiros y mortalidad</p>

      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <KpiCard
          label="Cobertura de vacunación (12 m)"
          value={kpis.vaccination_coverage_pct != null ? `${kpis.vaccination_coverage_pct}%` : '—'}
          hint="animales activos vacunados"
          tone={kpis.vaccination_coverage_pct >= 90 ? 'success' : 'warning'}
        />
        <KpiCard label="En tratamiento (30 d)" value={kpis.animals_in_treatment_30d} hint="animales tratados" />
        <KpiCard
          label="Retiros activos"
          value={kpis.active_withdrawals}
          hint={kpis.active_withdrawals ? 'bloqueados para faena/leche' : 'sin bloqueos'}
          tone={kpis.active_withdrawals ? 'warning' : 'success'}
        />
        <KpiCard
          label="Mortalidad (12 m)"
          value={kpis.mortality_12m.rate_pct != null ? `${kpis.mortality_12m.rate_pct}%` : '—'}
          hint={`${kpis.mortality_12m.deaths} muertes`}
          tone={kpis.mortality_12m.rate_pct > 3 ? 'danger' : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-5 gap-4 max-lg:grid-cols-1">
        <div className="col-span-3 space-y-4">
          <Card>
            <CardTitle action={<span className="text-label text-ink-3">{(withdrawals ?? []).length} activos</span>}>
              Retiros activos
            </CardTitle>
            {(withdrawals ?? []).length === 0 ? (
              <p className="py-5 text-center text-body text-ink-3">Sin retiros vigentes.</p>
            ) : (
              <table className="w-full text-body">
                <thead>
                  <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                    <th>Caravana</th>
                    <th>Producto</th>
                    <th>Aplicado</th>
                    <th className="text-right">Carne hasta</th>
                    <th className="pr-1 text-right">Días restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {(withdrawals ?? []).map((w: any) => (
                    <tr key={w.id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                      <td>
                        <Link href={`/animales/${w.animal_id}`} className="font-mono font-medium text-brand hover:underline">
                          {w.tag ?? '—'}
                        </Link>
                      </td>
                      <td className="text-ink-2">{w.product ?? '—'}</td>
                      <td className="text-ink-2">{formatDate(w.applied_at)}</td>
                      <td className="tnum text-right">{formatDate(w.meat_withdrawal_until)}</td>
                      <td className="pr-1 text-right">
                        <span className="inline-flex items-center gap-1 font-medium text-warning">
                          <Clock size={12} /> {w.days_left}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardTitle>Próximas vacunaciones (60 días)</CardTitle>
            {(upcoming ?? []).length === 0 ? (
              <p className="py-5 text-center text-body text-ink-3">
                Nada programado — los refuerzos con fecha aparecerán acá.
              </p>
            ) : (
              <div className="space-y-1">
                {(upcoming ?? []).slice(0, 10).map((v: any) => (
                  <Link
                    key={v.id}
                    href={`/animales/${v.animal_id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-body hover:bg-sunken"
                  >
                    <Syringe size={14} className="shrink-0 text-info" strokeWidth={1.75} />
                    <TagMono>{v.tag ?? '—'}</TagMono>
                    <span className="text-ink-2">{v.product}</span>
                    <span className="ml-auto text-label text-ink-3">
                      {formatDate(v.next_due_date)} · en {v.days_until} días
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle>Captura rápida</CardTitle>
          <SanidadCapture products={products ?? []} />
        </Card>
      </div>

      <MedicationsPanel products={products ?? []} />

      <HealthPlansPanel lots={lots ?? []} categories={categories ?? []} />
    </div>
  );
}
