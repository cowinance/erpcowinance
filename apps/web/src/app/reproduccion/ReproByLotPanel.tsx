'use client';

/**
 * Estado reproductivo AGREGADO por lote (Reproducción E6, integración con Lotes): cabezas, preñez %,
 * listas para servicio, diagnóstico pendiente y abiertas — rankeado por «listas». Lee
 * GET /reproduction/by-lot (compone la regla única de estado). Identifica lotes a preparar/revisar.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';

export function ReproByLotPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/reproduction/by-lot`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRows(d?.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card className="mt-4">
      <CardTitle>Reproducción por lote</CardTitle>
      {loading ? (
        <p className="py-5 text-center text-body text-ink-3">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="py-5 text-center text-body text-ink-3">Sin vientres por lote.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Lote</th>
                <th className="text-right">Cab.</th>
                <th className="text-right">Preñez</th>
                <th className="text-right">Listas</th>
                <th className="text-right">Diag. pend.</th>
                <th className="pr-1 text-right">Abiertas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lot_id ?? 'none'} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                  <td className="font-medium">
                    {r.lot_id ? <Link href="/lotes" className="text-ink hover:text-brand">{r.lot}</Link> : <span className="text-ink-3">{r.lot}</span>}
                  </td>
                  <td className="tnum text-right">{r.total}</td>
                  <td className={`tnum text-right ${r.pregnancy_rate_pct != null && r.pregnancy_rate_pct < 50 ? 'text-warning' : 'text-ink-2'}`}>{r.pregnancy_rate_pct != null ? `${r.pregnancy_rate_pct}%` : '—'}</td>
                  <td className={`tnum text-right ${r.ready_for_service ? 'text-info font-medium' : 'text-ink-3'}`}>{r.ready_for_service}</td>
                  <td className={`tnum text-right ${r.diagnosis_pending ? 'text-warning' : 'text-ink-3'}`}>{r.diagnosis_pending}</td>
                  <td className={`tnum pr-1 text-right ${r.open ? 'text-danger' : 'text-ink-3'}`}>{r.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
