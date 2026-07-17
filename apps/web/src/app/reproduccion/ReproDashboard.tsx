'use client';

/**
 * Dashboard reproductivo operativo (Reproducción E3): «qué tengo que hacer». Una sola llamada a
 * GET /reproduction/dashboard (compone estado/KPIs/próximas a preparar/partos/protocolos). Accesos
 * rápidos que enfocan la captura + buckets accionables. Complementa el estado del rodeo (tabla completa).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Activity, Baby, ClipboardList, HeartPulse, Loader2, Stethoscope, Syringe } from 'lucide-react';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

function focusCapture(tab: string) {
  window.dispatchEvent(new CustomEvent('repro:capture', { detail: tab }));
  document.getElementById('captura-repro')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const QUICK = [
  { label: 'Celo', icon: HeartPulse, action: () => focusCapture('Celo') },
  { label: 'Servicio', icon: Syringe, action: () => focusCapture('Servicio') },
  { label: 'Diagnosticar', icon: Stethoscope, action: () => focusCapture('Diagnóstico') },
  { label: 'Parto', icon: Baby, action: () => focusCapture('Parto') },
  { label: 'Protocolos', icon: ClipboardList, action: () => { window.location.href = '/reproduccion/protocolos'; } },
];

function Bucket({ title, icon: Icon, tone, rows, empty, render }: { title: string; icon: any; tone?: string; rows: any[]; empty: string; render: (r: any) => React.ReactNode }) {
  return (
    <div className={cardCls}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-subheading font-semibold"><Icon size={16} className={tone ?? 'text-brand'} /> {title}</h2>
        <span className="text-label text-ink-3">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-5 text-center text-body text-ink-3">{empty}</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">{rows.map(render)}</div>
      )}
    </div>
  );
}

export function ReproDashboard() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API_URL}/reproduction/dashboard`, { headers: authHeaders() }).then((x) => x.json()).catch(() => null);
    setD(r);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className={`mt-4 flex justify-center py-10 text-ink-3 ${cardCls}`}><Loader2 size={18} className="animate-spin" /></div>;
  if (!d) return null;

  const row = (main: React.ReactNode, meta: React.ReactNode, id: string, tone?: React.ReactNode) => (
    <Link key={id} href={`/animales/${id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
      <span className="tnum shrink-0 font-medium">{main}</span>
      <span className="min-w-0 flex-1 truncate text-label text-ink-3">{meta}</span>
      {tone}
    </Link>
  );

  return (
    <div className="mt-4 space-y-4">
      {/* Accesos rápidos */}
      <div className="flex flex-wrap gap-2">
        {QUICK.map((a) => (
          <button key={a.label} onClick={a.action} className="inline-flex items-center gap-1.5 rounded-md border border-subtle bg-surface px-3 py-1.5 text-label font-medium text-ink-2 shadow-[var(--shadow-1)] hover:border-strong hover:text-ink">
            <a.icon size={14} className="text-brand" /> {a.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Bucket title="Diagnóstico pendiente" icon={Stethoscope} tone="text-warning" rows={d.diagnosis_pending ?? []} empty="Sin diagnósticos pendientes."
          render={(r) => row(r.tag ?? '—', `${r.lot ?? 'sin lote'} · servicio hace ${r.days_since_service} d`, r.animal_id,
            <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-caption text-warning">{r.days_since_service} d</span>)} />

        <Bucket title="Abiertas críticas" icon={Activity} tone="text-danger" rows={d.critical_open ?? []} empty="Sin vacas abiertas críticas."
          render={(r) => row(r.tag ?? '—', `${r.lot ?? 'sin lote'} · ${r.status === 'repeat_breeder' ? 'repetidora' : 'abierta'}`, r.animal_id,
            <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-caption text-danger">{r.days_open != null ? `${r.days_open} d` : 'repet.'}</span>)} />

        <Bucket title="Partos próximos (30 d)" icon={Baby} rows={d.upcoming_calvings ?? []} empty="Sin partos próximos."
          render={(r) => row(r.tag ?? '—', `${r.name ?? ''} · parto ${formatDate(r.expected_due_date)}`, r.animal_id,
            <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-caption text-success">{r.days_until} d</span>)} />

        <Bucket title="Próximas a preparar" icon={Syringe} tone="text-info" rows={d.to_prepare ?? []} empty="Ninguna en la ventana."
          render={(r) => row(r.tag ?? '—', `${r.lot ?? 'sin lote'} · ${r.days_postpartum} d postparto`, r.animal_id,
            <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-caption text-info">en {r.days_to_vwp} d</span>)} />

        {/* Protocolos activos */}
        <div className={cardCls}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-subheading font-semibold"><ClipboardList size={16} className="text-brand" /> Protocolos activos</h2>
            <Link href="/reproduccion/protocolos" className="text-caption text-brand hover:underline">gestionar</Link>
          </div>
          {(d.active_protocols ?? []).length === 0 ? (
            <p className="py-5 text-center text-body text-ink-3">Sin protocolos activos.</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {(d.active_protocols ?? []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{a.protocol_name}</span>
                  <span className="shrink-0 text-caption text-ink-3">{a.lot_name} · {a.animal_count} vientres</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
