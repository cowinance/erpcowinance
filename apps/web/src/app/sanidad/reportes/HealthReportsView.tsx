'use client';

/**
 * Reportes sanitarios (Sanidad E7): incidencia por diagnóstico, mortalidad por causa/lote/período,
 * animales reincidentes, productos más usados y efectividad (recuperados vs muertos). Con filtro de
 * período y export CSV (helper único, anti-inyección).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { farmToday, addFarmDays } from '@/lib/date';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';
const money = (n: number) => (n ?? 0).toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Tab = 'incidence' | 'mortality' | 'recurrent' | 'products' | 'effectiveness';
const TABS: [Tab, string][] = [
  ['incidence', 'Incidencia'],
  ['mortality', 'Mortalidad'],
  ['recurrent', 'Reincidentes'],
  ['products', 'Productos'],
  ['effectiveness', 'Efectividad'],
];

export function HealthReportsView() {
  // El hoy lo calcula el cliente, que tiene la zona de la finca en el <html>. Venía del Server
  // Component, donde se computaba en la zona de ESA máquina (UTC en producción).
  const today = farmToday();
  const [tab, setTab] = useState<Tab>('incidence');
  const [from, setFrom] = useState(addFarmDays(today, -90));
  const [to, setTo] = useState(today);
  const [mortBy, setMortBy] = useState<'cause' | 'lot' | 'period'>('cause');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const url = useMemo(() => {
    const qs = `from=${from}&to=${to}`;
    if (tab === 'mortality') return `/health/reports/mortality?${qs}&by=${mortBy}`;
    return `/health/reports/${tab}?${qs}`;
  }, [tab, from, to, mortBy]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API_URL}${url}`, { headers: authHeaders() }).then((x) => x.json()).catch(() => null);
    setData(r);
    setLoading(false);
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    const rows = Array.isArray(data) ? data : [];
    let table: (string | number | null)[][] = [];
    if (tab === 'incidence') table = [['Diagnóstico', 'Categoría', 'Notificable', 'Eventos', 'Animales'], ...rows.map((r) => [r.diagnosis, r.category ?? '', r.is_notifiable ? 'sí' : 'no', r.events, r.animals])];
    else if (tab === 'mortality') table = mortBy === 'cause'
      ? [['Causa', 'Categoría', 'Muertes', 'Pérdida'], ...rows.map((r) => [r.cause, r.category ?? '', r.deaths, r.estimated_loss])]
      : mortBy === 'lot' ? [['Lote', 'Muertes', 'Pérdida'], ...rows.map((r) => [r.lot_name, r.deaths, r.estimated_loss])]
      : [['Período', 'Muertes', 'Pérdida'], ...rows.map((r) => [r.period, r.deaths, r.estimated_loss])];
    else if (tab === 'recurrent') table = [['Caravana', 'Categoría', 'Lote', 'Casos', 'Abiertos', 'Último'], ...rows.map((r) => [r.tag, r.category ?? '', r.lot_name ?? '', r.cases, r.open_cases, r.last_case ? formatDate(r.last_case) : ''])];
    else if (tab === 'products') table = [['Producto', 'Tipo', 'Aplicaciones', 'Animales', 'Costo'], ...rows.map((r) => [r.product, r.type, r.applications, r.animals, r.cost])];
    if (table.length) downloadCsv(`sanidad-${tab}.csv`, table);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <Link href="/sanidad" className="mb-1 inline-flex items-center gap-1 text-label text-ink-3 hover:text-ink-2">
            <ArrowLeft size={13} /> Sanidad
          </Link>
          <h1 className="text-xl font-semibold">Reportes sanitarios</h1>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-compat-10 font-medium text-ink-2">Desde</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} controlSize="sm" fullWidth={false} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-compat-10 font-medium text-ink-2">Hasta</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} controlSize="sm" fullWidth={false} />
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-subtle p-0.5">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 text-label font-medium ${tab === k ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:text-ink-2'}`}>{l}</button>
          ))}
        </div>
        {tab === 'mortality' && (
          <Select value={mortBy} onChange={(e) => setMortBy(e.target.value as any)} controlSize="sm" fullWidth={false}>
            <option value="cause">Por causa</option>
            <option value="lot">Por lote</option>
            <option value="period">Por mes</option>
          </Select>
        )}
        {tab !== 'effectiveness' && (
          <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-subtle px-3 py-1.5 text-label font-medium text-ink-2 hover:border-strong">
            <Download size={14} /> CSV
          </button>
        )}
      </div>

      <div className={cardCls}>
        {loading ? (
          <div className="flex justify-center py-10 text-ink-3"><Loader2 size={18} className="animate-spin" /></div>
        ) : tab === 'effectiveness' ? (
          <Effectiveness e={data} />
        ) : (
          <ReportTable tab={tab} mortBy={mortBy} rows={Array.isArray(data) ? data : []} />
        )}
      </div>
    </div>
  );
}

function Effectiveness({ e }: { e: any }) {
  if (!e || !e.total) return <p className="py-10 text-center text-body text-ink-3">Sin casos clínicos en el período.</p>;
  const items = [
    { label: 'Casos totales', value: e.total, tone: 'text-ink' },
    { label: 'Recuperados', value: e.recovered, tone: 'text-success' },
    { label: 'Muertos', value: e.died, tone: 'text-danger' },
    { label: 'Derivados', value: e.referred, tone: 'text-ink-2' },
    { label: 'Abiertos', value: e.open, tone: 'text-warning' },
  ];
  return (
    <div>
      <div className="grid grid-cols-5 gap-4 max-md:grid-cols-2">
        {items.map((i) => (
          <div key={i.label}>
            <div className={`text-heading font-semibold ${i.tone}`}>{i.value}</div>
            <div className="text-label text-ink-3">{i.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-subtle pt-3 text-body">
        Tasa de recuperación: <span className="font-semibold text-success">{e.recovery_rate_pct != null ? `${e.recovery_rate_pct}%` : '—'}</span>
        <span className="text-ink-3"> (recuperados sobre casos resueltos)</span>
      </div>
    </div>
  );
}

function ReportTable({ tab, mortBy, rows }: { tab: Tab; mortBy: string; rows: any[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-body text-ink-3">Sin datos en el período.</p>;
  const th = 'h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.04em] text-ink-3 uppercase';
  const td = 'h-8 border-b border-subtle/60 last:border-0';

  if (tab === 'incidence') return (
    <table className="w-full text-body"><thead><tr className={th}><th>Diagnóstico</th><th>Categoría</th><th className="text-right">Eventos</th><th className="text-right">Animales</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.diagnosis_id} className={td}><td className="font-medium">{r.diagnosis}{r.is_notifiable ? <span className="ml-1 text-warning">⚠</span> : null}</td><td className="text-ink-2">{r.category ?? '—'}</td><td className="tnum text-right">{r.events}</td><td className="tnum text-right">{r.animals}</td></tr>
      ))}</tbody></table>
  );
  if (tab === 'mortality') return (
    <table className="w-full text-body"><thead><tr className={th}><th>{mortBy === 'cause' ? 'Causa' : mortBy === 'lot' ? 'Lote' : 'Mes'}</th><th className="text-right">Muertes</th><th className="text-right">Pérdida</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className={td}><td className="font-medium">{r.cause ?? r.lot_name ?? r.period}{r.is_notifiable ? <span className="ml-1 text-warning">⚠</span> : null}</td><td className="tnum text-right">{r.deaths}</td><td className="tnum text-right">{money(r.estimated_loss)}</td></tr>
      ))}</tbody></table>
  );
  if (tab === 'recurrent') return (
    <table className="w-full text-body"><thead><tr className={th}><th>Caravana</th><th>Categoría</th><th>Lote</th><th className="text-right">Casos</th><th className="text-right">Abiertos</th><th className="text-right">Último</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.animal_id} className={td}><td className="tnum font-medium">{r.tag ?? '—'}</td><td className="text-ink-2">{r.category ?? '—'}</td><td className="text-ink-2">{r.lot_name ?? '—'}</td><td className="tnum text-right font-medium">{r.cases}</td><td className="tnum text-right">{r.open_cases}</td><td className="tnum text-right text-ink-3">{r.last_case ? formatDate(r.last_case) : '—'}</td></tr>
      ))}</tbody></table>
  );
  return (
    <table className="w-full text-body"><thead><tr className={th}><th>Producto</th><th>Tipo</th><th className="text-right">Aplicaciones</th><th className="text-right">Animales</th><th className="text-right">Costo</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.product_id} className={td}><td className="font-medium">{r.product}</td><td className="text-ink-2">{r.type}</td><td className="tnum text-right">{r.applications}</td><td className="tnum text-right">{r.animals}</td><td className="tnum text-right">{money(r.cost)}</td></tr>
      ))}</tbody></table>
  );
}
