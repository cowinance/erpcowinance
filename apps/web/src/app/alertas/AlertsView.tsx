'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { AlertTriangle, Info, ShieldAlert, RefreshCw, Check, X, Eye } from 'lucide-react';
import { Button } from '@/components/Button';

interface Alert {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  status: string;
  triggered_at: string;
  tag: string | null;
}

const SEVERITY = {
  critical: { label: 'Críticas', icon: ShieldAlert, color: 'var(--danger)', border: 'border-danger' },
  warning: { label: 'Atención', icon: AlertTriangle, color: 'var(--warning)', border: 'border-warning' },
  info: { label: 'Informativas', icon: Info, color: 'var(--info)', border: 'border-info' },
} as const;

export function AlertsView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (evaluate = false) => {
      setLoading(true);
      try {
        if (evaluate) await fetch(`${API_URL}/alerts/evaluate`, { method: 'POST', headers: authHeaders() });
        const [list, k] = await Promise.all([
          fetch(`${API_URL}/alerts?status=${filter}`, { headers: authHeaders() }).then((r) => r.json()),
          fetch(`${API_URL}/alerts/kpis`, { headers: authHeaders() }).then((r) => r.json()),
        ]);
        setAlerts(list);
        setKpis(k);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  // Evaluación al abrir; recarga al cambiar filtro
  useEffect(() => {
    load(filter === 'active');
  }, [load, filter]);

  async function act(id: string, action: 'acknowledge' | 'resolve' | 'dismiss') {
    await fetch(`${API_URL}/alerts/${id}/${action}`, { method: 'POST', headers: authHeaders() });
    load();
  }

  const grouped = (['critical', 'warning', 'info'] as const).map((sev) => ({
    sev,
    items: alerts.filter((a) => a.severity === sev),
  }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="tab-strip flex gap-1 rounded-md bg-sunken p-1">
          {(['active', 'resolved'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-8 shrink-0 whitespace-nowrap rounded px-3 text-body font-medium ${
                filter === f ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {f === 'active' ? 'Activas' : 'Resueltas'}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(true)} className="gap-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Reevaluar
        </Button>
      </div>

      {kpis && filter === 'active' && (
        <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
          <Kpi label="Abiertas" value={kpis.open} />
          <Kpi label="Críticas" value={kpis.critical} color={kpis.critical ? 'var(--danger)' : undefined} />
          <Kpi label="Atención" value={kpis.warning} color={kpis.warning ? 'var(--warning)' : undefined} />
          <Kpi label="Reconocidas" value={kpis.acknowledged} />
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="rounded-[10px] border border-subtle bg-surface py-14 text-center shadow-[var(--shadow-1)]">
          <Check size={22} className="mx-auto mb-2 text-success" />
          <p className="text-[14px] font-medium">{filter === 'active' ? 'Todo en orden' : 'Sin alertas resueltas'}</p>
          <p className="mt-1 text-body text-ink-3">
            {filter === 'active' ? 'No hay alertas activas en este momento.' : 'Las alertas que resuelvas aparecerán acá.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(
            ({ sev, items }) =>
              items.length > 0 && (
                <div key={sev}>
                  <div className="mb-2 flex items-center gap-2 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                    {SEVERITY[sev].label} · {items.length}
                  </div>
                  <div className="space-y-2">
                    {items.map((a) => {
                      const Icon = SEVERITY[a.severity].icon;
                      return (
                        <div
                          key={a.id}
                          className={`flex items-center gap-3 rounded-[10px] border border-subtle border-l-[3px] ${SEVERITY[a.severity].border} bg-surface px-4 py-3 shadow-[var(--shadow-1)]`}
                        >
                          <Icon size={18} style={{ color: SEVERITY[a.severity].color }} className="shrink-0" strokeWidth={1.75} />
                          <div className="min-w-0 flex-1">
                            <div className="text-body font-medium">
                              {a.related_type === 'animal' && a.related_id ? (
                                <Link href={`/animales/${a.related_id}`} className="hover:underline">
                                  {a.title}
                                </Link>
                              ) : (
                                a.title
                              )}
                              {a.status === 'acknowledged' && (
                                <span className="ml-2 rounded-full bg-sunken px-1.5 py-0.5 text-compat-10 font-normal text-ink-3">
                                  reconocida
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-label text-ink-2">{a.message}</div>
                            <div className="mt-0.5 text-caption text-ink-3">{relativeTime(a.triggered_at)}</div>
                          </div>
                          {filter === 'active' && (
                            <div className="flex shrink-0 items-center gap-1">
                              {a.status === 'open' && (
                                <IconBtn title="Reconocer" onClick={() => act(a.id, 'acknowledge')}>
                                  <Eye size={15} />
                                </IconBtn>
                              )}
                              <IconBtn title="Resolver" onClick={() => act(a.id, 'resolve')}>
                                <Check size={15} />
                              </IconBtn>
                              <IconBtn title="Descartar" onClick={() => act(a.id, 'dismiss')}>
                                <X size={15} />
                              </IconBtn>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-[10px] border border-subtle bg-surface p-4 shadow-[var(--shadow-1)]">
      <div className="text-label text-ink-2">{label}</div>
      <div className="tnum mt-1 text-compat-26 font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}
