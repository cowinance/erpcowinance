'use client';

/**
 * Planes sanitarios reutilizables (Módulo B3): ver los planes/calendarios,
 * aplicarlos a un objetivo (hato/categoría/lote) generando tareas programadas,
 * y gestionar esas tareas (recordatorios que alimentan el motor de alertas).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { CalendarClock, Check, ChevronRight, Loader2, ClipboardList } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

export function HealthPlansPanel({ lots, categories }: { lots: any[]; categories: any[] }) {
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [target, setTarget] = useState('all');
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10));
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      fetch(`${API_URL}/health-plans`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API_URL}/health/tasks?status=pending`, { headers: authHeaders() }).then((r) => r.json()),
    ]);
    setPlans(p);
    setTasks(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(planId: string) {
    setApplying(true);
    setMsg('');
    const body: any = { anchor_date: anchor };
    if (target.startsWith('lot:')) body.lot_id = target.slice(4);
    else if (target.startsWith('cat:')) body.category_code = target.slice(4);
    const res = await fetch(`${API_URL}/health-plans/${planId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    setApplying(false);
    if (res.ok) {
      setMsg(`✓ ${j.tasks_created} tareas creadas sobre ${j.animals} animales${j.tasks_skipped ? ` (${j.tasks_skipped} ya existían)` : ''}`);
      setOpenPlan(null);
      await load();
      router.refresh();
    } else {
      setMsg(apiErrorTitle(j, 'No se pudo aplicar el plan'));
    }
  }

  async function complete(id: string) {
    await fetch(`${API_URL}/health/tasks/${id}/complete`, { method: 'POST', headers: authHeaders() });
    await load();
    router.refresh();
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      {/* Planes / calendarios */}
      <div className={cardCls}>
        <h2 className="mb-1 flex items-center gap-2 text-subheading font-semibold">
          <CalendarClock size={16} className="text-brand" /> Planes sanitarios
        </h2>
        <p className="mb-3 text-label text-ink-3">Calendarios reutilizables — aplicá uno para generar los recordatorios.</p>

        {loading ? (
          <div className="flex justify-center py-6 text-ink-3">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="rounded-md border border-subtle">
                <button
                  onClick={() => setOpenPlan(openPlan === p.id ? null : p.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken"
                >
                  <ChevronRight size={14} className={`text-ink-3 transition-transform ${openPlan === p.id ? 'rotate-90' : ''}`} />
                  <span className="flex-1 text-body font-medium">{p.name}</span>
                  <span className="text-caption text-ink-3">{p.steps} pasos · {p.species}</span>
                </button>
                {openPlan === p.id && (
                  <div className="border-t border-subtle px-3 py-3">
                    <ul className="mb-3 space-y-1">
                      {(p.schedule ?? []).map((s: any, i: number) => (
                        <li key={i} className="flex items-center gap-2 text-label text-ink-2">
                          <span className="tnum w-14 shrink-0 text-ink-3">día {s.offset_days}</span>
                          <span className="font-medium text-ink">{s.label}</span>
                          <span className="text-ink-3">
                            · {s.applies_to?.length ? s.applies_to.join(', ') : 'todas las categorías'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-compat-10 font-medium text-ink-2">Aplicar a</span>
                        <Select value={target} onChange={(e) => setTarget(e.target.value)} controlSize="sm" fullWidth={false}>
                          <option value="all">Todo el hato</option>
                          {categories.filter((c) => c.animal_count > 0).map((c) => (
                            <option key={c.code} value={`cat:${c.code}`}>
                              {c.name}s
                            </option>
                          ))}
                          {lots.map((l) => (
                            <option key={l.id} value={`lot:${l.id}`}>
                              Lote: {l.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-compat-10 font-medium text-ink-2">Fecha ancla</span>
                        <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} controlSize="sm" fullWidth={false} />
                      </label>
                      <Button size="sm" onClick={() => apply(p.id)} loading={applying} className="gap-1.5">
                        {applying ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : 'Aplicar plan'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {msg && <p className={`mt-3 text-label ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}
      </div>

      {/* Tareas programadas */}
      <div className={cardCls}>
        <h2 className="mb-1 flex items-center gap-2 text-subheading font-semibold">
          <ClipboardList size={16} className="text-brand" /> Tareas pendientes
        </h2>
        <p className="mb-3 text-label text-ink-3">{tasks.length} tareas sanitarias programadas.</p>
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin tareas pendientes. Aplicá un plan para generarlas.</p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {tasks.slice(0, 40).map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{t.title}</div>
                  <div className={`text-caption ${t.overdue ? 'text-warning' : 'text-ink-3'}`}>
                    {t.overdue ? 'Vencida' : 'Vence'} · {formatDate(t.due_date)}
                  </div>
                </div>
                {t.animal_id && (
                  <Link href={`/animales/${t.animal_id}`} className="shrink-0 text-caption text-brand hover:underline">
                    ver
                  </Link>
                )}
                <button
                  title="Marcar como hecha"
                  onClick={() => complete(t.id)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-brand-soft hover:text-brand"
                >
                  <Check size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
