import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, KpiCard, EmptyState, TagMono } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { VerificationBanner } from '@/components/VerificationBanner';
import { FarmSetup, type Setup } from '@/components/FarmSetup';
import { EVENT_LABELS, relativeTime } from '@/lib/format';
import { Plus, Zap, CheckSquare, Stethoscope, Syringe, Heart, Baby, ArrowLeftRight, AlertTriangle, Scale, Scissors, StickyNote, Tag } from 'lucide-react';
import { AgendaAttention } from '@/components/AgendaAttention';
import { focusFor, orderActionsByRole, orderPriorityByRole } from '@/lib/role-focus';
import { SampleData } from '@/components/SampleData';

/** Acciones rápidas del Inicio (Home E3): actuar, no solo mirar. Rutas existentes + anchors de captura. */
const QUICK_ACTIONS = [
  { label: 'Modo manga', href: '/manga', Icon: Zap },
  { label: 'Crear animal', href: '/animales/nuevo', Icon: Plus },
  { label: 'Nueva tarea', href: '/tareas', Icon: CheckSquare },
  { label: 'Tratamiento', href: '/sanidad#captura', Icon: Stethoscope },
  { label: 'Vacuna', href: '/sanidad#captura', Icon: Syringe },
  { label: 'Servicio', href: '/reproduccion#captura-repro', Icon: Heart },
  { label: 'Parto', href: '/reproduccion#captura-repro', Icon: Baby },
  { label: 'Mover', href: '/animales', Icon: ArrowLeftRight },
  { label: 'Tareas vencidas', href: '/tareas?bucket=overdue', Icon: AlertTriangle },
];

/** Ícono + color por tipo de evento para diferenciar la actividad reciente visualmente. */
const EVENT_STYLE: Record<string, { Icon: any; cls: string }> = {
  birth: { Icon: Baby, cls: 'text-info' },
  weighing: { Icon: Scale, cls: 'text-brand' },
  treatment: { Icon: Stethoscope, cls: 'text-danger' },
  vaccination: { Icon: Syringe, cls: 'text-danger' },
  pregnancy_diagnosed: { Icon: Heart, cls: 'text-info' },
  pregnancy_negative: { Icon: Heart, cls: 'text-warning' },
  note: { Icon: StickyNote, cls: 'text-ink-3' },
  identifier_added: { Icon: Tag, cls: 'text-ink-2' },
  edit: { Icon: StickyNote, cls: 'text-ink-3' },
  cull: { Icon: Scissors, cls: 'text-warning' },
};

/**
 * Inicio como CENTRO DE CONTROL DIARIO (Home E2). Consume el endpoint agregado /dashboard/home
 * (compone dashboard/tasks/alerts/health/repro). Jerarquía: Atención prioritaria arriba de todo →
 * Estado general → KPIs integrados → agenda/gráficos/actividad. Mantiene onboarding y estados vacíos.
 */

const SEV = {
  critical: { border: 'border-l-danger', text: 'text-danger', chip: 'bg-danger/10 text-danger' },
  warning: { border: 'border-l-warning', text: 'text-warning', chip: 'bg-warning/10 text-warning' },
  info: { border: 'border-l-info', text: 'text-info', chip: 'bg-info/10 text-info' },
} as const;

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }> = {
  // `unknown` es lo que el backend manda cuando la fuente de ese renglón no cargó. NO es verde: un
  // semáforo en verde afirma algo sobre la finca, y afirmarlo sin haber podido mirar es la mentira
  // que más caro sale — el productor cierra la pantalla tranquilo.
  unknown: { label: 'Sin datos', tone: 'muted' },
  ok: { label: 'Al día', tone: 'success' },
  late: { label: 'Con atrasos', tone: 'warning' },
  critical: { label: 'Crítica', tone: 'danger' },
  stable: { label: 'Estable', tone: 'success' },
  attention: { label: 'Requiere atención', tone: 'warning' },
  action: { label: 'Requiere acción', tone: 'warning' },
  overdue: { label: 'Vencidas', tone: 'warning' },
};
/**
 * Nombre en castellano de cada pieza que el Inicio compone, para poder DECIR cuál falló.
 *
 * El backend degrada por pieza y manda `degraded`. Sin este cartel el productor vería una sección
 * en blanco o un «Sin datos» suelto y no tendría cómo distinguir «no hay nada» de «no se pudo
 * mirar» — que en sanidad es justo la diferencia que importa.
 */
const PIEZA: Record<string, string> = {
  hato: 'hato',
  tareas: 'tareas',
  alertas: 'alertas',
  sanidad: 'sanidad',
  reproduccion: 'reproducción',
  agenda_tareas: 'agenda de tareas',
  pesajes: 'pesajes',
  actividad: 'actividad reciente',
  primeros_pasos: 'primeros pasos',
};

const TONE_CHIP: Record<string, string> = {
  muted: 'bg-sunken text-ink-3',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

export default async function Dashboard() {
  const [home, me, farms] = await Promise.all([
    apiSafe<any>('/dashboard/home'),
    apiSafe<any>('/auth/me'),
    apiSafe<any[]>('/farms'),
  ]);

  if (!home) {
    return (
      <EmptyState
        title="La API no está disponible"
        body="Iniciá el backend con `npm run api` (puerto 3001) y recargá esta página."
      />
    );
  }

  const k = home.kpis;

  // El saludo y la fecha, en la hora de la FINCA.
  //
  // Esto es un Server Component: `new Date().getHours()` daba la hora de la máquina que renderiza
  // —UTC en producción—, no la del productor. A las 00:30 de un lunes en Venezuela la pantalla
  // decía «domingo 26» y saludaba como si fuera de tarde. Es la misma corrección que ya se había
  // hecho en los reportes de reproducción; el Inicio era la última pantalla que faltaba.
  //
  // La zona sale de la organización, que `me` ya trae: es la de la finca y no la del dispositivo,
  // porque el día de trabajo pertenece a la finca — un veterinario que carga desde otra provincia
  // tiene que ver el día de la finca, no el suyo.
  const tz = me?.organization?.timezone ?? undefined;
  const ahora = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(ahora));
  const greeting = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  // `es` y no `es-AR`: la app se registra con país y no todos los productores son argentinos. El
  // formato largo en castellano es el mismo; lo que cambiaba era pretender una localidad ajena.
  const rawDate = ahora.toLocaleDateString('es', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const today = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const neverPopulated = (k.total_animals ?? 0) === 0;
  const noActiveButHasHistory = !neverPopulated && (k.active_animals ?? 0) === 0;
  const fs = home.farm_status ?? {};
  const degraded: string[] = home.degraded ?? [];
  // Qué le falta a la finca para estar en marcha (O-2). Derivado del estado real por el backend:
  // acá no se decide nada, solo se dibuja.
  const setup = home.setup as Setup;

  // Personalización por rol (E5): reordena énfasis sin ocultar nada. owner/admin/otros → orden base.
  const focus = focusFor(home.role);
  const priority = orderPriorityByRole((home.priority ?? []) as any[], home.role);
  const quickActions = orderActionsByRole(QUICK_ACTIONS, home.role);
  const allClear = priority.length === 0 && fs.operation === 'ok' && fs.health === 'stable' && fs.reproduction === 'stable';

  return (
    <div>
      <VerificationBanner
        initialVerified={!!me?.email_verified}
        email={me?.email}
        emailDelivery={me?.email_delivery}
      />

      {neverPopulated ? (
        <>
          <FarmSetup setup={setup} greetingName={me?.name} farmName={farms?.[0]?.name} />
          {/* El ofrecimiento va DEBAJO de los primeros pasos: cargar el hato propio es lo que se
              quiere que haga; los datos de ejemplo son para mirar, no el camino principal. */}
          <div className="mt-5">
            <SampleData hasAnimals={false} />
          </div>
        </>
      ) : noActiveButHasHistory ? (
        <EmptyState
          title="No tenés animales activos"
          body="Tu finca tiene animales registrados, pero ninguno activo en este momento. Revisá el historial completo en tu hato."
          actionHref="/animales"
          actionLabel="Ver hato"
        />
      ) : (
        <>
          {/* El aviso de datos de ejemplo va PRIMERO: si el productor se olvida de que están,
              cada número que mire debajo es mentira. */}
          <SampleData hasAnimals />

          {/* Primeros pasos: sigue estando hasta que la finca esté armada. El panel viejo se iba
              al cargar el primer animal, justo cuando empezaba a hacer falta. */}
          <FarmSetup setup={setup} />

          {/* Cabecera */}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                {greeting}, {me?.name?.split(' ')[0] ?? ''}
              </h1>
              <p className="mt-0.5 flex items-center gap-2 text-body text-ink-3">
                <span>
                  {today}
                  {farms?.[0]?.name ? ` · ${farms[0].name}` : ''}
                </span>
                {focus && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-caption font-medium text-brand">Vista: {focus.label}</span>}
              </p>
            </div>
            <Link
              href="/animales/nuevo"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-body font-medium text-white hover:opacity-90"
            >
              <Plus size={15} /> Capturar
            </Link>
          </div>

          {/* Todo al día — estado vacío positivo (E5): sin urgencias y estado estable */}
          {allClear && (
            <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-success/30 bg-success/5 px-4 py-3 text-body text-success">
              <span className="text-lg">✓</span> Todo al día — sin urgencias en tu finca hoy.
            </div>
          )}

          {/* Atención prioritaria — arriba de todo (Home E2) */}
          {priority.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2 text-label font-medium text-ink-2">
                Atención prioritaria
                <span className="rounded-full bg-danger/10 px-1.5 text-caption font-medium text-danger">{priority.reduce((a, p) => a + p.count, 0)}</span>
              </div>
              <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-3 max-md:grid-cols-2">
                {priority.slice(0, 8).map((p) => {
                  const sev = SEV[p.severity as keyof typeof SEV] ?? SEV.info;
                  return (
                    <Link
                      key={p.code}
                      href={p.href}
                      className={`rounded-[10px] border border-subtle border-l-[3px] ${sev.border} bg-surface px-4 py-3 shadow-[var(--shadow-1)] transition-colors hover:bg-sunken`}
                    >
                      <div className={`tnum text-compat-28 font-bold leading-none ${sev.text}`}>{p.count}</div>
                      <div className="mt-1 text-label text-ink-2">{p.label}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {degraded.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-md border-l-[3px] border-warning bg-warning/10 px-3 py-2 text-body">
              <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0">
                <span className="font-medium">Faltan datos de {degraded.map((d: string) => PIEZA[d] ?? d).join(', ')}.</span>{' '}
                <span className="text-ink-2">
                  El resto de la pantalla es correcto. Los números de {degraded.length > 1 ? 'esas secciones' : 'esa sección'} aparecen como «—»: no
                  son ceros, es que no se pudieron leer. Recargá en un momento.
                </span>
              </div>
            </div>
          )}

          {/* Estado general de la finca */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-label font-medium text-ink-3">Estado:</span>
            {[
              ['Operación', fs.operation],
              ['Sanidad', fs.health],
              ['Reproducción', fs.reproduction],
              ['Tareas', fs.tasks],
            ].map(([label, val]) => {
              // El respaldo tampoco es verde. Antes era `tone: 'success'`, así que un estado que la
              // pantalla no supiera interpretar se dibujaba como «todo bien».
              const s = STATUS[val as string] ?? { label: 'Sin datos', tone: 'muted' as const };
              return (
                <span key={label as string} className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1 text-label">
                  <span className="text-ink-2">{label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${TONE_CHIP[s.tone]}`}>{s.label}</span>
                </span>
              );
            })}
          </div>

          {/* Acciones rápidas — actuar desde el Inicio (Home E3), priorizadas por rol (E5) */}
          <div className="mb-5 flex flex-wrap gap-2">
            {quickActions.map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-subtle bg-surface px-3 text-label font-medium text-ink-2 shadow-[var(--shadow-1)] transition-colors hover:bg-sunken hover:text-ink"
              >
                <Icon size={15} className="text-ink-3" /> {label}
              </Link>
            ))}
          </div>

          {/* KPIs integrados */}
          <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
            <KpiCard label="Animales activos" value={k.active_animals ?? "—"} hint={k.active_animals == null ? 'sin dato del hato' : k.new_this_month ? `+${k.new_this_month} este mes` : 'sin altas este mes'} tone={k.new_this_month ? 'success' : undefined} />
            <KpiCard label="GDP promedio (120 d)" value={k.avg_adg_kg_day ?? '—'} unit="kg/día" hint="ganancia diaria de peso" />
            <KpiCard label="Preñez efectiva" value={k.pregnancy_rate_pct != null ? `${k.pregnancy_rate_pct}%` : '—'} hint={k.breeding_females != null ? `${k.open_pregnancies} de ${k.breeding_females} vientres` : "sin dato de vientres"} />
            <KpiCard label="Retiros activos" value={k.active_withdrawals ?? "—"} hint={k.active_withdrawals == null ? 'sin dato de sanidad' : k.active_withdrawals ? 'bloqueados para faena' : 'sin bloqueos'} tone={k.active_withdrawals == null ? undefined : k.active_withdrawals ? 'warning' : 'success'} />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
            <KpiCard label="Tareas vencidas" value={k.overdue_tasks ?? "—"} hint={k.urgent_tasks ? `${k.urgent_tasks} urgentes` : 'de la finca'} tone={k.overdue_tasks ? 'warning' : 'success'} />
            <KpiCard label="Cumplimiento (30 d)" value={k.compliance_pct != null ? `${k.compliance_pct}%` : '—'} hint={k.done_today != null ? `${k.done_today} completadas hoy` : "sin dato de tareas"} tone={k.compliance_pct != null && k.compliance_pct >= 70 ? 'success' : undefined} />
            <KpiCard label="Alertas críticas" value={k.critical_alerts ?? "—"} hint={k.open_alerts != null ? `${k.open_alerts} alertas abiertas` : "sin dato de alertas"} tone={k.critical_alerts ? 'warning' : 'success'} />
            <KpiCard label="Vacunas vencidas" value={k.vaccines_overdue ?? "—"} hint={k.vaccines_overdue == null ? 'sin dato de sanidad' : k.vaccines_due_45d ? `${k.vaccines_due_45d} próximas (45 d)` : 'al día'} tone={k.vaccines_overdue == null ? undefined : k.vaccines_overdue ? 'warning' : 'success'} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            {/* Atención hoy — agenda combinada de /dashboard/home */}
            <Card>
              <CardTitle>Atención hoy</CardTitle>
              <AgendaAttention items={home.agenda ?? []} total={home.agenda_total} overflowTasks={home.agenda_overflow_tasks} />
            </Card>

            <Card>
              <CardTitle action={<span className="text-label text-ink-3">promedio del hato · 12 meses</span>}>Evolución de peso</CardTitle>
              <WeightChart points={(home.weight_series ?? []).map((p: any) => ({ label: p.month.slice(5), value: p.avg_kg }))} />
            </Card>

            <Card>
              <CardTitle>Hato por categoría</CardTitle>
              <div className="space-y-2">
                {(home.by_category ?? []).map((c: any) => {
                  const pct = k.active_animals ? (c.n / k.active_animals) * 100 : 0;
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

            <Card>
              <CardTitle>Actividad reciente</CardTitle>
              {(home.recent_activity ?? []).length === 0 && (
                <p className="py-6 text-center text-body text-ink-3">Sin actividad reciente todavía.</p>
              )}
              <div className="space-y-0.5">
                {(home.recent_activity ?? []).slice(0, 9).map((e: any, i: number) => {
                  const st = EVENT_STYLE[e.event_type] ?? { Icon: StickyNote, cls: 'text-ink-3' };
                  const Icon = st.Icon;
                  return (
                    <Link key={i} href={`/animales/${e.animal_id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-body hover:bg-sunken">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sunken">
                        <Icon size={13} className={st.cls} />
                      </span>
                      <span className="w-28 shrink-0 font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        <TagMono>{e.tag ?? '—'}</TagMono>
                        {e.event_type === 'weighing' && e.payload?.weight_kg && <span className="tnum"> · {e.payload.weight_kg} kg</span>}
                        {e.lot_name && <span className="text-ink-3"> · {e.lot_name}</span>}
                        {e.actor_name && <span className="text-ink-3"> · {e.actor_name.split(' ')[0]}</span>}
                      </span>
                      <span className="shrink-0 text-label text-ink-3">{relativeTime(e.occurred_at)}</span>
                    </Link>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
