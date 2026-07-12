import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, KpiCard, EmptyState, TagMono } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { VerificationBanner } from '@/components/VerificationBanner';
import { EmptyFarmState } from '@/components/EmptyFarmState';
import { EVENT_LABELS, relativeTime } from '@/lib/format';
import { Plus } from 'lucide-react';
import { AgendaAttention } from '@/components/AgendaAttention';

export default async function Dashboard() {
  const [kpis, me, farms, agenda] = await Promise.all([
    apiSafe<any>('/dashboard/kpis'),
    apiSafe<any>('/auth/me'),
    apiSafe<any[]>('/farms'),
    apiSafe<any[]>('/agenda'),
  ]);

  if (!kpis) {
    return (
      <EmptyState
        title="La API no está disponible"
        body="Iniciá el backend con `npm run api` (puerto 3001) y recargá esta página."
      />
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const rawDate = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const withdrawals = kpis.alerts?.active_withdrawals ?? [];
  // Onboarding SOLO si la finca nunca tuvo animales: total_animals cuenta el
  // inventario existente (no borrados, cualquier estado; ver DashboardService).
  // active_animals sigue siendo el KPI y NO decide el onboarding (P1.3.5a).
  const neverPopulated = (kpis.total_animals ?? 0) === 0;
  const noActiveButHasHistory = !neverPopulated && (kpis.active_animals ?? 0) === 0;

  return (
    <div>
      {/* Banner suave de verificación (P1.3.5): estado inicial de /auth/me;
          se auto-oculta si ya está verificado. Coexiste con empty-state y dashboard. */}
      <VerificationBanner initialVerified={!!me?.email_verified} email={me?.email} />

      {neverPopulated ? (
        <EmptyFarmState greetingName={me?.name} farmName={farms?.[0]?.name} />
      ) : noActiveButHasHistory ? (
        <EmptyState
          title="No tenés animales activos"
          body="Tu finca tiene animales registrados, pero ninguno activo en este momento. Revisá el historial completo en tu hato."
          actionHref="/animales"
          actionLabel="Ver hato"
        />
      ) : (
        <>
      {/* Cabecera (doc diseño §11.2) */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {greeting}, {me?.name?.split(' ')[0] ?? ''}
          </h1>
          <p className="mt-0.5 text-body text-ink-3">
            {today}
            {farms?.[0]?.name ? ` · ${farms[0].name}` : ''}
          </p>
        </div>
        <Link
          href="/animales/nuevo"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-body font-medium text-white hover:opacity-90"
        >
          <Plus size={15} /> Capturar
        </Link>
      </div>

      {/* Fila de vitales */}
      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <KpiCard
          label="Animales activos"
          value={kpis.active_animals}
          hint={kpis.new_this_month ? `+${kpis.new_this_month} este mes` : 'sin altas este mes'}
          tone={kpis.new_this_month ? 'success' : undefined}
        />
        <KpiCard
          label="GDP promedio (120 d)"
          value={kpis.avg_adg_kg_day ?? '—'}
          unit="kg/día"
          hint="ganancia diaria de peso"
        />
        <KpiCard
          label="Preñez efectiva"
          value={kpis.pregnancy.rate != null ? `${kpis.pregnancy.rate}%` : '—'}
          hint={`${kpis.pregnancy.open} preñeces de ${kpis.pregnancy.breeding_females} vientres`}
        />
        <KpiCard
          label="Retiros activos"
          value={withdrawals.length}
          hint={withdrawals.length ? 'animales bloqueados para faena' : 'sin bloqueos'}
          tone={withdrawals.length ? 'warning' : 'success'}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {/* Atención hoy — agenda estructurada de /agenda (P4-4), misma fuente que el móvil */}
        <Card>
          <CardTitle>Atención hoy</CardTitle>
          <AgendaAttention items={agenda ?? []} />
        </Card>

        {/* Evolución de peso */}
        <Card>
          <CardTitle
            action={<span className="text-label text-ink-3">promedio del hato · 12 meses</span>}
          >
            Evolución de peso
          </CardTitle>
          <WeightChart
            points={(kpis.weight_series ?? []).map((p: any) => ({
              label: p.month.slice(5),
              value: p.avg_kg,
            }))}
          />
        </Card>

        {/* Composición del hato */}
        <Card>
          <CardTitle>Hato por categoría</CardTitle>
          <div className="space-y-2">
            {(kpis.by_category ?? []).map((c: any) => {
              const pct = kpis.active_animals ? (c.n / kpis.active_animals) * 100 : 0;
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-body text-ink-2">{c.category}s</div>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-sunken">
                    <div className="h-full rounded-sm bg-brand-300" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="tnum w-8 text-right text-body font-medium">{c.n}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Actividad reciente */}
        <Card>
          <CardTitle>Actividad reciente</CardTitle>
          <div className="space-y-0.5">
            {(kpis.recent_events ?? []).slice(0, 8).map((e: any, i: number) => (
              <Link
                key={i}
                href={`/animales/${e.animal_id}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-body hover:bg-sunken"
              >
                <span className="w-32 shrink-0 font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                <span className="text-ink-2">
                  caravana <TagMono>{e.tag ?? '—'}</TagMono>
                  {e.event_type === 'weighing' && e.payload?.weight_kg && (
                    <span className="tnum"> · {e.payload.weight_kg} kg</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-label text-ink-3">{relativeTime(e.occurred_at)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
        </>
      )}
    </div>
  );
}
