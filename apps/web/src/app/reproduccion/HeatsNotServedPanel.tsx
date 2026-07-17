'use client';

/**
 * Celos detectados sin servicio posterior (Reproducción E2): a quién servir. Lee
 * GET /reproduction/heats-not-served (celo sin servicio ni preñez abierta posterior).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { formatDate } from '@/lib/format';

export function HeatsNotServedPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/reproduction/heats-not-served?days=30`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardTitle action={<span className="text-label text-ink-3">{rows.length}</span>}>Celos sin servir (30 d)</CardTitle>
      {loading ? (
        <p className="py-5 text-center text-body text-ink-3">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="py-5 text-center text-body text-ink-3">Sin celos pendientes de servir.</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <Link key={r.animal_id} href={`/animales/${r.animal_id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
              <span className="tnum shrink-0 font-medium">{r.tag ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate text-label text-ink-3">{r.lot ?? 'sin lote'}</span>
              <span className="shrink-0 text-caption text-ink-3">celo {formatDate(r.last_heat)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
