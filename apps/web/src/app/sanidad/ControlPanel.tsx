'use client';

/**
 * Panel de control sanitario (Sanidad E3): accesos rápidos, animales críticos (con motivos y
 * urgencia) y sanidad por lote (qué lotes concentran más problemas). Vistas de CONTROL sobre los
 * endpoints /health/critical-animals y /health/by-lot — complementan la captura rápida.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Activity, AlertTriangle, ClipboardList, Loader2, Search, Skull, Stethoscope, Syringe } from 'lucide-react';
import { Input } from '@/components/Input';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

/** Enfoca la captura rápida en una pestaña concreta (evento desacoplado que escucha SanidadCapture). */
function focusCapture(tab: string) {
  window.dispatchEvent(new CustomEvent('sanidad:capture', { detail: tab }));
  document.getElementById('captura')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const QUICK = [
  { label: 'Vacunar', icon: Syringe, action: () => focusCapture('Vacunación') },
  { label: 'Tratar', icon: Stethoscope, action: () => focusCapture('Tratamiento') },
  { label: 'Diagnosticar', icon: Activity, action: () => focusCapture('Diagnóstico') },
  { label: 'Registrar muerte', icon: Skull, action: () => focusCapture('Mortalidad') },
  { label: 'Aplicar plan', icon: ClipboardList, action: () => scrollTo('planes') },
  { label: 'Ver retiros', icon: AlertTriangle, action: () => scrollTo('retiros') },
];

const PURPOSE_ES: Record<string, string> = {
  breeding: 'Cría', fattening: 'Engorde', dairy: 'Tambo', weaning: 'Recría', quarantine: 'Cuarentena', hospital: 'Hospital',
};
const SEV_ES: Record<string, string> = { mild: 'Leve', moderate: 'Moderada', severe: 'Severa' };

export function ControlPanel() {
  const [critical, setCritical] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [c, l, an] = await Promise.all([
      fetch(`${API_URL}/health/critical-animals`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
      fetch(`${API_URL}/health/by-lot`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
      fetch(`${API_URL}/health/reports/mortality-anomaly`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
    ]);
    setCritical(Array.isArray(c) ? c : []);
    setLots(Array.isArray(l) ? l : []);
    setAnomalies(Array.isArray(an) ? an : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCritical = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return critical;
    return critical.filter((a) =>
      [a.tag, a.lot_name, a.category, a.diagnosis].filter(Boolean).some((s: string) => s.toLowerCase().includes(term)),
    );
  }, [critical, q]);

  const problemLots = lots.filter((l) => l.problem_score > 0);

  return (
    <div className="mt-4 space-y-4">
      {/* Alerta de mortalidad anormal por lote */}
      {anomalies.length > 0 && (
        <div className="rounded-[10px] border border-danger/40 bg-danger/5 p-3">
          <div className="flex items-center gap-2 text-label font-medium text-danger">
            <AlertTriangle size={15} /> Mortalidad anormal (últimos 90 días)
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-2">
            {anomalies.map((a) => (
              <span key={a.lot_id}>{a.lot_name}: <span className="font-medium text-danger">{a.mortality_pct}%</span> ({a.deaths}/{a.head})</span>
            ))}
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div className="flex flex-wrap gap-2">
        {QUICK.map((a) => (
          <button
            key={a.label}
            onClick={a.action}
            className="inline-flex items-center gap-1.5 rounded-md border border-subtle bg-surface px-3 py-1.5 text-label font-medium text-ink-2 shadow-[var(--shadow-1)] hover:border-strong hover:text-ink"
          >
            <a.icon size={14} className="text-brand" /> {a.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {/* Animales críticos */}
        <div className={cardCls}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-subheading font-semibold">
              <AlertTriangle size={16} className="text-warning" /> Animales críticos
            </h2>
            <span className="text-label text-ink-3">{filteredCritical.length}</span>
          </div>
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} controlSize="sm" placeholder="Buscar caravana, lote, diagnóstico…" className="pl-8" />
          </div>
          {loading ? (
            <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          ) : filteredCritical.length === 0 ? (
            <p className="py-6 text-center text-body text-ink-3">Sin animales que requieran atención. 🎉</p>
          ) : (
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {filteredCritical.map((a) => (
                <Link key={a.animal_id} href={`/animales/${a.animal_id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
                  <span className="tnum shrink-0 font-medium">{a.tag ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-label text-ink-3">
                    {a.category ?? ''}{a.lot_name ? ` · ${a.lot_name}` : ''}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {a.has_open_case && (
                      <span className="rounded bg-brand-soft px-1.5 py-0.5 text-caption text-brand" title={a.diagnosis ?? 'Caso clínico'}>
                        caso{a.case_severity ? ` · ${SEV_ES[a.case_severity]}` : ''}
                      </span>
                    )}
                    {a.has_withdrawal && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption text-warning">retiro</span>}
                    {a.has_overdue_vaccination && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-caption text-danger">vacuna vencida</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Sanidad por lote */}
        <div className={cardCls}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-subheading font-semibold">
              <Activity size={16} className="text-brand" /> Sanidad por lote
            </h2>
            <span className="text-label text-ink-3">{problemLots.length} con problemas</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          ) : problemLots.length === 0 ? (
            <p className="py-6 text-center text-body text-ink-3">Ningún lote con problemas sanitarios.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-label">
                <thead>
                  <tr className="h-7 border-b border-subtle text-left text-caption font-medium tracking-[0.04em] text-ink-3 uppercase">
                    <th className="font-medium">Lote</th>
                    <th className="text-right font-medium" title="Casos abiertos">Casos</th>
                    <th className="text-right font-medium" title="Retiros activos">Retiros</th>
                    <th className="text-right font-medium" title="Vacunas vencidas">Vac. venc.</th>
                    <th className="text-right font-medium" title="Muertes (90 d)">Muertes</th>
                  </tr>
                </thead>
                <tbody>
                  {problemLots.map((l) => (
                    <tr key={l.lot_id} className="border-b border-subtle/60 last:border-0">
                      <td className="py-1.5">
                        <Link href={`/lotes`} className="font-medium text-ink hover:text-brand">{l.lot_name}</Link>
                        <span className="ml-1 text-caption text-ink-3">{PURPOSE_ES[l.purpose] ?? ''} · {l.head} cab.</span>
                      </td>
                      <td className={`tnum text-right ${l.open_cases ? 'text-brand' : 'text-ink-3'}`}>{l.open_cases}</td>
                      <td className={`tnum text-right ${l.active_withdrawals ? 'text-warning' : 'text-ink-3'}`}>{l.active_withdrawals}</td>
                      <td className={`tnum text-right ${l.overdue_vaccinations ? 'text-danger' : 'text-ink-3'}`}>{l.overdue_vaccinations}</td>
                      <td className={`tnum text-right ${l.deaths_90d ? 'text-danger' : 'text-ink-3'}`}>{l.deaths_90d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
