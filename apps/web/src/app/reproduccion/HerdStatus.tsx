'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Select } from '@/components/Select';
import { formatDate } from '@/lib/format';

/**
 * Estado reproductivo del rodeo (R-1): tabla de vientres activos con su estado snapshot
 * (preñada / servida / vacía / sin actividad), filtrable por lote. Lee GET /reproduction/herd-status.
 */
const STATUS: Record<string, { label: string; cls: string }> = {
  pregnant: { label: 'Preñada', cls: 'text-success' },
  served: { label: 'Servida', cls: 'text-brand' },
  empty: { label: 'Vacía', cls: 'text-warning' },
  idle: { label: 'Sin actividad', cls: 'text-ink-3' },
};
const ORDER = ['pregnant', 'served', 'empty', 'idle'] as const;

export function HerdStatus({ lots }: { lots: { id: string; name: string }[] }) {
  const [lotId, setLotId] = useState('');
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

  const counts = data?.counts;
  const rows: any[] = data?.rows ?? [];

  return (
    <Card>
      <CardTitle
        action={
          <Select value={lotId} onChange={(e) => setLotId(e.target.value)} controlSize="sm" fullWidth={false} aria-label="Filtrar por lote">
            <option value="">Todos los lotes</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        }
      >
        Estado del rodeo
      </CardTitle>

      {counts && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {ORDER.map((k) => (
            <span key={k} className={`text-label font-medium ${STATUS[k].cls}`}>
              {STATUS[k].label}: <span className="tnum">{counts[k]}</span>
            </span>
          ))}
          <span className="ml-auto text-label text-ink-3">{counts.total} vientres</span>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-body text-ink-3">Cargando…</p>
      ) : error ? (
        <p role="alert" className="py-6 text-center text-body text-danger">
          No se pudo cargar el estado del rodeo.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin vientres en este lote.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Caravana</th>
                <th>Nombre</th>
                <th>Lote</th>
                <th>Estado</th>
                <th className="text-right">Parto esperado</th>
                <th className="pr-1 text-right">Último servicio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.animal_id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                  <td>
                    <Link href={`/animales/${r.animal_id}`} className="font-mono font-medium text-brand hover:underline">
                      {r.tag ?? '—'}
                    </Link>
                  </td>
                  <td className="text-ink-2">{r.name ?? '—'}</td>
                  <td className="text-ink-2">{r.lot ?? '—'}</td>
                  <td>
                    <span className={`font-medium ${STATUS[r.status]?.cls ?? ''}`}>{STATUS[r.status]?.label ?? r.status}</span>
                  </td>
                  <td className="tnum text-right">
                    {r.expected_due_date ? `${formatDate(r.expected_due_date)}${r.days_until != null ? ` · ${r.days_until}d` : ''}` : '—'}
                  </td>
                  <td className="pr-1 text-right text-ink-3">{r.last_service_date ? formatDate(r.last_service_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
