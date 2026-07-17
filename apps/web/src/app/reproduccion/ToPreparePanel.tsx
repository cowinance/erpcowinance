'use client';

/**
 * Próximas vacas a preparar para servicio (Reproducción E1): vientres en postparto cuyos días
 * postparto alcanzarán el VWP dentro de la ventana. Lee GET /reproduction/to-prepare (fuente única:
 * regla de estado). Acción operativa del dashboard reproductivo.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Select } from '@/components/Select';

export function ToPreparePanel() {
  const [days, setDays] = useState('7');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API_URL}/reproduction/to-prepare?days=${days}`, { headers: authHeaders() }).then((x) => x.json()).catch(() => null);
    setData(r);
    setLoading(false);
  }, [days]);
  useEffect(() => {
    load();
  }, [load]);

  const rows: any[] = data?.rows ?? [];

  return (
    <Card>
      <CardTitle
        action={
          <Select value={days} onChange={(e) => setDays(e.target.value)} controlSize="sm" fullWidth={false} aria-label="Ventana">
            <option value="7">Próximos 7 días</option>
            <option value="14">Próximos 14 días</option>
            <option value="30">Próximos 30 días</option>
          </Select>
        }
      >
        Próximas a preparar para servicio
      </CardTitle>
      {data?.vwp_days != null && (
        <p className="mb-2 text-label text-ink-3">Descanso postparto (VWP): {data.vwp_days} días · {data.count} vaca{data.count === 1 ? '' : 's'}</p>
      )}
      {loading ? (
        <p className="py-6 text-center text-body text-ink-3">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Ninguna vaca a preparar en la ventana.</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <Link key={r.animal_id} href={`/animales/${r.animal_id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
              <span className="tnum shrink-0 font-medium">{r.tag ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate text-label text-ink-3">{r.lot ?? 'sin lote'} · {r.days_postpartum} d postparto</span>
              <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-caption text-info">en {r.days_to_vwp} d</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
