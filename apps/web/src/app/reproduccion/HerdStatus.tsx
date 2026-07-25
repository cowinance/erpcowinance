'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Select } from '@/components/Select';
import { formatDate } from '@/lib/format';

/**
 * Estado reproductivo RICO del rodeo (Reproducción E1): vientres activos con su estado DERIVADO por la
 * regla única (preñada, próxima a parir, servida, diagnóstico pendiente, postparto, lista para servicio,
 * abierta, repetidora, etc.) + días postparto / abiertos / desde servicio. Filtrable por lote y estado.
 */
const STATUS: Record<string, { label: string; cls: string }> = {
  pregnant: { label: 'Preñada', cls: 'bg-success/10 text-success' },
  due_soon: { label: 'Próxima a parir', cls: 'bg-success/10 text-success' },
  served: { label: 'Servida', cls: 'bg-brand-soft text-brand' },
  diagnosis_pending: { label: 'Diagnóstico pendiente', cls: 'bg-warning/10 text-warning' },
  in_protocol: { label: 'En protocolo', cls: 'bg-brand-soft text-brand' },
  aborted: { label: 'Abortada', cls: 'bg-danger/10 text-danger' },
  postpartum_rest: { label: 'Descanso postparto', cls: 'bg-sunken text-ink-2' },
  ready_for_review: { label: 'Lista para revisión', cls: 'bg-warning/10 text-warning' },
  ready_for_service: { label: 'Lista para servicio', cls: 'bg-info/10 text-info' },
  repeat_breeder: { label: 'Repetidora', cls: 'bg-danger/10 text-danger' },
  open: { label: 'Abierta', cls: 'bg-danger/10 text-danger' },
  empty: { label: 'Vacía', cls: 'bg-warning/10 text-warning' },
  culled: { label: 'Descartada', cls: 'bg-sunken text-ink-3' },
};
// Estados destacados en el resumen (los más accionables).
const SUMMARY = ['pregnant', 'due_soon', 'diagnosis_pending', 'ready_for_service', 'open', 'repeat_breeder'] as const;

function Badge({ status }: { status: string }) {
  const s = STATUS[status];
  return <span className={`rounded px-1.5 py-0.5 text-caption ${s?.cls ?? 'bg-sunken text-ink-3'}`}>{s?.label ?? status}</span>;
}

export function HerdStatus({ lots }: { lots: { id: string; name: string }[] }) {
  const [lotId, setLotId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${API_URL}/reproduction/herd-status${lotId ? `?lot_id=${lotId}` : ''}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lotId]);
  useEffect(() => {
    load();
  }, [load]);

  const counts = data?.counts ?? {};
  const rows: any[] = data?.rows ?? [];
  const filtered = useMemo(() => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows), [rows, statusFilter]);

  return (
    <Card>
      <CardTitle
        action={
          // `flex-wrap`: dos selectores no entran al lado del título en un teléfono.
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} controlSize="sm" fullWidth={false} aria-label="Filtrar por estado">
              <option value="">Todos los estados</option>
              {Object.entries(STATUS).filter(([k]) => (counts[k] ?? 0) > 0).map(([k, v]) => (
                <option key={k} value={k}>{v.label} ({counts[k]})</option>
              ))}
            </Select>
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)} controlSize="sm" fullWidth={false} aria-label="Filtrar por lote">
              <option value="">Todos los lotes</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
        }
      >
        Estado del rodeo
      </CardTitle>

      {counts.total != null && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {SUMMARY.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
            <button key={k} onClick={() => setStatusFilter(statusFilter === k ? '' : k)} className="inline-flex items-center gap-1">
              <Badge status={k} /><span className="tnum text-label font-medium">{counts[k]}</span>
            </button>
          ))}
          <span className="ml-auto text-label text-ink-3">{counts.total} vientres</span>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-body text-ink-3">Cargando…</p>
      ) : error ? (
        <p role="alert" className="py-6 text-center text-body text-danger">No se pudo cargar el estado del rodeo.</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin vientres{statusFilter ? ' con ese estado' : ' en este lote'}.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Caravana</th>
                <th>Estado</th>
                <th>Lote</th>
                <th className="text-right">Postparto</th>
                <th className="text-right">Abiertos</th>
                <th className="pr-1 text-right">Parto / serv.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.animal_id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                  <td>
                    <Link href={`/animales/${r.animal_id}`} className="font-mono font-medium text-brand hover:underline">{r.tag ?? '—'}</Link>
                  </td>
                  <td><Badge status={r.status} /></td>
                  <td className="text-ink-2">{r.lot ?? '—'}</td>
                  <td className="tnum text-right text-ink-2">{r.days_postpartum != null ? `${r.days_postpartum} d` : '—'}</td>
                  <td className={`tnum text-right ${r.days_open != null && r.days_open >= 90 ? 'text-danger' : 'text-ink-2'}`}>{r.days_open != null ? `${r.days_open} d` : '—'}</td>
                  <td className="pr-1 text-right text-ink-3">
                    {r.expected_due_date ? `${formatDate(r.expected_due_date)}${r.days_until != null ? ` · ${r.days_until}d` : ''}` : r.days_since_service != null ? `serv. ${r.days_since_service}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
