'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Download, Loader2 } from 'lucide-react';

type ReportKey = 'inventory' | 'movements' | 'production' | 'reproduction';

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: 'inventory', label: 'Inventario a fecha' },
  { key: 'movements', label: 'Altas y bajas' },
  { key: 'production', label: 'Producción' },
  { key: 'reproduction', label: 'Reproducción' },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86400000).toISOString().slice(0, 10);

function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) => r.map((c) => (c == null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(','))
    .join('\n');
}

function download(name: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls = 'h-9 rounded-md border border-strong bg-surface px-3 text-[13px] outline-none focus:ring-2 focus:ring-brand';
const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

export function ReportsView() {
  const [tab, setTab] = useState<ReportKey>('inventory');
  const [at, setAt] = useState(today());
  const [from, setFrom] = useState(monthsAgo(12));
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<'category' | 'lot' | 'sex'>('category');
  // El dato guarda a qué reporte pertenece: así nunca renderizamos un
  // componente con datos de otra pestaña mientras llega el fetch nuevo.
  const [result, setResult] = useState<{ forTab: ReportKey; payload: any } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const data = result?.payload;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs =
        tab === 'inventory'
          ? `herd-inventory?at=${at}&group_by=${groupBy}`
          : tab === 'movements'
            ? `herd-movements?from=${from}&to=${to}`
            : tab === 'production'
              ? `production?from=${from}&to=${to}`
              : `reproduction?from=${from}&to=${to}`;
      const res = await fetch(`${API_URL}/reports/${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setResult({ forTab: tab, payload: await res.json() });
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tab, at, from, to, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!result) return;
    const { forTab, payload: data } = result;
    let rows: (string | number | null)[][] = [];
    let name = 'reporte.csv';
    if (forTab === 'inventory') {
      name = `inventario-hato-${data.at}.csv`;
      rows = [[data.dimension, 'Animales'], ...data.rows.map((r: any) => [r.grupo, r.n]), ['Total', data.total]];
    } else if (forTab === 'movements') {
      name = `altas-bajas-${data.from}_${data.to}.csv`;
      rows = [
        ['Concepto', 'Cantidad'],
        ['Nacimientos', data.altas.nacimientos],
        ['Compras', data.altas.compras],
        ['Total altas', data.altas.total],
        ['Ventas', data.bajas.ventas],
        ['Muertes', data.bajas.muertes],
        ['Descartes', data.bajas.descartes],
        ['Transferencias', data.bajas.transferencias],
        ['Total bajas', data.bajas.total],
        ['Variación neta', data.variacion_neta],
      ];
    } else if (forTab === 'production') {
      name = `produccion-${data.from}_${data.to}.csv`;
      rows = [
        ['Lote', 'Pesajes', 'Animales', 'Peso prom. (kg)', 'GDP prom. (kg/d)'],
        ...data.rows.map((r: any) => [r.lote, r.pesajes, r.animales, r.peso_promedio, r.gdp_promedio]),
      ];
    } else {
      name = `reproduccion-${data.from}_${data.to}.csv`;
      rows = [
        ['Concepto', 'Cantidad'],
        ['Inseminaciones', data.servicios.ia],
        ['Montas', data.servicios.monta],
        ['Total servicios', data.servicios.total],
        ['Diagnósticos', data.diagnosticos],
        ['Partos', data.partos],
        ['Crías nacidas', data.crias_nacidas],
        ['Destetes', data.destetes.n],
      ];
    }
    download(name, toCsv(rows));
  }

  return (
    <div>
      {/* Selector de reporte */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-sunken p-1">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setTab(r.key)}
              className={`h-8 rounded px-3 text-[13px] font-medium ${
                tab === r.key ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={!data}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-sunken disabled:opacity-50"
        >
          <Download size={15} /> Exportar CSV
        </button>
      </div>

      {/* Filtros de fecha */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {tab === 'inventory' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-2">A la fecha</span>
              <input type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-2">Agrupar por</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className={inputCls}>
                <option value="category">Categoría</option>
                <option value="lot">Lote</option>
                <option value="sex">Sexo</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-2">Desde</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-2">Hasta</span>
              <input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
          </>
        )}
      </div>

      {loading ? (
        <div className={`${cardCls} flex items-center justify-center py-16 text-ink-3`}>
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : error ? (
        <div className={`${cardCls} py-10 text-center text-[13px] text-danger`}>{error}</div>
      ) : (
        result && (
          <>
            {result.forTab === 'inventory' && <InventoryReport data={result.payload} />}
            {result.forTab === 'movements' && <MovementsReport data={result.payload} />}
            {result.forTab === 'production' && <ProductionReport data={result.payload} />}
            {result.forTab === 'reproduction' && <ReproductionReport data={result.payload} />}
          </>
        )
      )}
    </div>
  );
}

function InventoryReport({ data }: { data: any }) {
  const max = Math.max(...data.rows.map((r: any) => r.n), 1);
  return (
    <div className={cardCls}>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-[13px] text-ink-2">Existencias al {new Date(data.at).toLocaleDateString('es-AR')}</div>
          <div className="text-[11px] text-ink-3">reconstruido por el ciclo de vida de cada animal</div>
        </div>
        <div className="tnum text-[30px] font-semibold">
          {data.total}
          <span className="ml-1.5 text-[13px] font-normal text-ink-2">cabezas</span>
        </div>
      </div>
      <div className="space-y-2">
        {data.rows.map((r: any) => (
          <div key={r.grupo} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-[13px] text-ink-2">{r.grupo}</div>
            <div className="h-5 flex-1 overflow-hidden rounded-sm bg-sunken">
              <div className="h-full rounded-sm bg-brand-300" style={{ width: `${(r.n / max) * 100}%` }} />
            </div>
            <div className="tnum w-10 text-right text-[13px] font-medium">{r.n}</div>
          </div>
        ))}
        {data.rows.length === 0 && <p className="py-6 text-center text-[13px] text-ink-3">Sin animales a esa fecha.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-md bg-sunken p-3">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div
        className={`tnum text-[22px] font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function MovementsReport({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
      <div className={cardCls}>
        <div className="mb-3 text-[14px] font-semibold text-success">Altas · {data.altas.total}</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Nacimientos" value={data.altas.nacimientos} />
          <Stat label="Compras" value={data.altas.compras} />
        </div>
      </div>
      <div className={cardCls}>
        <div className="mb-3 text-[14px] font-semibold text-danger">Bajas · {data.bajas.total}</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Ventas" value={data.bajas.ventas} />
          <Stat label="Muertes" value={data.bajas.muertes} />
          <Stat label="Descartes" value={data.bajas.descartes} />
          <Stat label="Transferencias" value={data.bajas.transferencias} />
        </div>
      </div>
      <div className={cardCls}>
        <div className="mb-3 text-[14px] font-semibold">Variación neta</div>
        <Stat
          label="Cabezas"
          value={`${data.variacion_neta >= 0 ? '+' : ''}${data.variacion_neta}`}
          tone={data.variacion_neta >= 0 ? 'success' : 'danger'}
        />
      </div>
    </div>
  );
}

function ProductionReport({ data }: { data: any }) {
  return (
    <div className={cardCls}>
      <div className="mb-3 text-[13px] text-ink-2">
        {data.total_pesajes} pesajes registrados en el período
      </div>
      {data.rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-3">Sin pesajes en el período.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="h-8 border-b border-subtle text-left text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th>Lote</th>
              <th className="text-right">Pesajes</th>
              <th className="text-right">Animales</th>
              <th className="text-right">Peso prom.</th>
              <th className="pr-1 text-right">GDP prom.</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.lote} className="h-9 border-b border-subtle last:border-0">
                <td className="font-medium">{r.lote}</td>
                <td className="tnum text-right text-ink-2">{r.pesajes}</td>
                <td className="tnum text-right text-ink-2">{r.animales}</td>
                <td className="tnum text-right">{r.peso_promedio ?? '—'} kg</td>
                <td className="tnum pr-1 text-right font-medium">
                  {r.gdp_promedio != null ? `${r.gdp_promedio.toFixed(2)} kg/d` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReproductionReport({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
      <div className={cardCls}>
        <div className="mb-2 text-[13px] font-semibold">Servicios</div>
        <div className="tnum text-[26px] font-semibold">{data.servicios.total}</div>
        <div className="mt-1 text-[12px] text-ink-3">
          {data.servicios.ia} IA · {data.servicios.monta} monta
        </div>
      </div>
      <div className={cardCls}>
        <div className="mb-2 text-[13px] font-semibold">Diagnósticos</div>
        <div className="tnum text-[26px] font-semibold">{data.diagnosticos}</div>
        <div className="mt-1 text-[12px] text-ink-3">de gestación</div>
      </div>
      <div className={cardCls}>
        <div className="mb-2 text-[13px] font-semibold">Partos</div>
        <div className="tnum text-[26px] font-semibold">{data.partos}</div>
        <div className="mt-1 text-[12px] text-ink-3">{data.crias_nacidas} crías nacidas</div>
      </div>
      <div className={cardCls}>
        <div className="mb-2 text-[13px] font-semibold">Destetes</div>
        <div className="tnum text-[26px] font-semibold">{data.destetes.n}</div>
        <div className="mt-1 text-[12px] text-ink-3">
          {data.destetes.peso_promedio ? `${data.destetes.peso_promedio} kg prom.` : 'sin peso'}
        </div>
      </div>
    </div>
  );
}
