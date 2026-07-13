'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, KpiCard } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Button } from '@/components/Button';

interface Lot {
  id: string;
  name: string;
}
interface Data {
  from: string;
  to: string;
  production: any;
  series: any;
  condition: any;
}

const BUCKET_TONE: Record<string, string> = {
  Flaca: 'bg-warning',
  Óptima: 'bg-success',
  Gorda: 'bg-info',
};

/** Barra horizontal simple (ancho %), theme-aware, sin dependencia de gráficos. */
function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  );
}

export function ProduccionView({ lots, initial }: { lots: Lot[]; initial: Data }) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [lotId, setLotId] = useState('');
  const [data, setData] = useState<Data>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const lotQ = lotId ? `&lot_id=${lotId}` : '';
    try {
      const [production, series, condition] = await Promise.all([
        fetch(`${API_URL}/reports/production?from=${from}&to=${to}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
        fetch(`${API_URL}/reports/production-weight-series?from=${from}&to=${to}${lotQ}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
        fetch(`${API_URL}/reports/condition-distribution?${lotQ.slice(1)}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
      ]);
      setData({ from, to, production, series, condition });
    } catch (e: any) {
      setError('No se pudieron cargar los datos de producción.');
    } finally {
      setLoading(false);
    }
  }, [from, to, lotId]);

  // Re-fetch al cambiar el lote (los rangos de fecha se aplican con «Aplicar»).
  const firstRun = initial;
  useEffect(() => {
    if (data === firstRun && !lotId) return; // evita el fetch redundante en el primer render
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId]);

  const prodRows: any[] = data.production?.rows ?? [];
  const maxPesajes = Math.max(1, ...prodRows.map((r) => r.pesajes ?? 0));
  const seriesPoints = (data.series?.rows ?? []).map((p: any) => ({ label: String(p.month).slice(5), value: p.avg_kg }));
  const buckets: any[] = data.condition?.buckets ?? [];
  const ccTotal = data.condition?.total ?? 0;
  const gdpProm = prodRows.length ? prodRows.reduce((s, r) => s + (r.gdp_promedio ?? 0) * r.pesajes, 0) / prodRows.reduce((s, r) => s + r.pesajes, 0) : null;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-label text-ink-3">
          Desde
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block" />
        </label>
        <label className="text-label text-ink-3">
          Hasta
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block" />
        </label>
        <label className="text-label text-ink-3">
          Lote
          <Select value={lotId} onChange={(e) => setLotId(e.target.value)} className="mt-0.5 block" aria-label="Filtrar por lote">
            <option value="">Todos los lotes</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        <Button onClick={load} loading={loading} disabled={loading}>
          {loading ? 'Aplicando…' : 'Aplicar'}
        </Button>
      </div>

      {error ? (
        <Card>
          <p role="alert" className="py-6 text-center text-body text-danger">
            {error}
          </p>
        </Card>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <KpiCard label="Pesajes en el período" value={data.production?.total_pesajes ?? 0} />
        <KpiCard label="GDP promedio" value={gdpProm != null ? gdpProm.toFixed(2) : '—'} unit="kg/día" />
        <KpiCard label="Animales con CC" value={ccTotal} hint="condición corporal registrada" />
      </div>

      {/* Curva de peso */}
      <Card>
        <CardTitle action={<span className="text-label text-ink-3">promedio por mes</span>}>Evolución de peso</CardTitle>
        <WeightChart points={seriesPoints} />
      </Card>

      {/* GDP por lote */}
      <Card>
        <CardTitle>Ganancia diaria (GDP) por lote</CardTitle>
        {prodRows.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin pesajes en el período.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {prodRows.map((r) => (
              <div key={r.lote} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-body">{r.lote}</div>
                <Bar pct={(r.pesajes / maxPesajes) * 100} tone="bg-brand" />
                <div className="w-44 shrink-0 text-right text-label text-ink-3">
                  <span className="font-semibold text-ink">{r.gdp_promedio != null ? `${r.gdp_promedio} kg/día` : '—'}</span>
                  {' · '}
                  {r.peso_promedio} kg · {r.animales} anim.
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Distribución de condición corporal */}
      <Card>
        <CardTitle action={<span className="text-label text-ink-3">última CC por animal</span>}>Condición corporal</CardTitle>
        {ccTotal === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin condición corporal registrada.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <div className="w-20 shrink-0 text-body">{b.label}</div>
                <Bar pct={(b.n / ccTotal) * 100} tone={BUCKET_TONE[b.label] ?? 'bg-brand'} />
                <div className="w-24 shrink-0 text-right text-label text-ink-3">
                  <span className="font-semibold text-ink">{b.n}</span> ({Math.round((b.n / ccTotal) * 100)}%)
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
