import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, KpiCard, EmptyState, TagMono } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { EVENT_LABELS, formatDate, relativeTime } from '@/lib/format';
import { AlertTriangle, Syringe, Plus } from 'lucide-react';

export default async function Dashboard() {
  const [kpis, me, farms] = await Promise.all([
    apiSafe<any>('/dashboard/kpis'),
    apiSafe<any>('/auth/me'),
    apiSafe<any[]>('/farms'),
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

  return (
    <div>
      {/* Cabecera (doc diseño §11.2) */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {greeting}, {me?.name?.split(' ')[0] ?? ''}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {today}
            {farms?.[0]?.name ? ` · ${farms[0].name}` : ''}
          </p>
        </div>
        <Link
          href="/animales/nuevo"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-[13px] font-medium text-white hover:opacity-90"
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
        {/* Atención hoy */}
        <Card>
          <CardTitle>Atención hoy</CardTitle>
          <div className="space-y-1.5">
            {withdrawals.map((w: any) => (
              <Link
                key={w.animal_id}
                href={`/animales/${w.animal_id}`}
                className="flex items-center gap-3 rounded-md border-l-[3px] border-warning bg-sunken px-3 py-2 hover:bg-brand-soft"
              >
                <AlertTriangle size={16} className="shrink-0 text-warning" strokeWidth={1.75} />
                <div className="min-w-0 flex-1 text-[13px]">
                  <span className="font-medium">
                    Retiro de carne — caravana <TagMono>{w.tag ?? '—'}</TagMono>
                  </span>
                  <span className="text-ink-3"> · {w.product ?? 'tratamiento'} hasta {formatDate(w.meat_withdrawal_until)}</span>
                </div>
              </Link>
            ))}
            {kpis.alerts.vaccinations_due_30d > 0 && (
              <div className="flex items-center gap-3 rounded-md border-l-[3px] border-info bg-sunken px-3 py-2">
                <Syringe size={16} className="shrink-0 text-info" strokeWidth={1.75} />
                <div className="text-[13px]">
                  <span className="font-medium">{kpis.alerts.vaccinations_due_30d} vacunaciones</span>
                  <span className="text-ink-3"> vencen en los próximos 30 días</span>
                </div>
              </div>
            )}
            {!withdrawals.length && !kpis.alerts.vaccinations_due_30d && (
              <p className="py-6 text-center text-[13px] text-ink-3">Todo en orden — sin alertas pendientes.</p>
            )}
          </div>
        </Card>

        {/* Evolución de peso */}
        <Card>
          <CardTitle
            action={<span className="text-[12px] text-ink-3">promedio del hato · 12 meses</span>}
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
                  <div className="w-24 shrink-0 text-[13px] text-ink-2">{c.category}s</div>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-sunken">
                    <div className="h-full rounded-sm bg-brand-300" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="tnum w-8 text-right text-[13px] font-medium">{c.n}</div>
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
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-sunken"
              >
                <span className="w-32 shrink-0 font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                <span className="text-ink-2">
                  caravana <TagMono>{e.tag ?? '—'}</TagMono>
                  {e.event_type === 'weighing' && e.payload?.weight_kg && (
                    <span className="tnum"> · {e.payload.weight_kg} kg</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-[12px] text-ink-3">{relativeTime(e.occurred_at)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
