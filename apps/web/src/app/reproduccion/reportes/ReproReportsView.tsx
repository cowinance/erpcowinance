'use client';

/**
 * Reportes reproductivos (Reproducción E5): resumen (KPIs de período), desempeño por toro, y listas
 * (abiertas, repetidoras, diagnósticos pendientes, abortos). Con filtro de período y export CSV
 * (helper único anti-inyección). Espejo del patrón de reportes de Sanidad.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { Input } from '@/components/Input';
import { farmToday, addFarmDays } from '@/lib/date';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);

type Tab = 'summary' | 'by-bull' | 'synchronization' | 'open' | 'repeat' | 'diagnosis-pending' | 'abortions';
const TABS: [Tab, string][] = [
  ['summary', 'Resumen'],
  ['by-bull', 'Por toro'],
  ['synchronization', 'Sincronización'],
  ['open', 'Abiertas'],
  ['repeat', 'Repetidoras'],
  ['diagnosis-pending', 'Diag. pendiente'],
  ['abortions', 'Abortos'],
];
const th = 'h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.04em] text-ink-3 uppercase';
const td = 'h-8 border-b border-subtle/60 last:border-0';

export function ReproReportsView() {
  // El hoy lo calcula el cliente, que tiene la zona de la finca en el <html>. Venía del Server
  // Component, donde se computaba en la zona de ESA máquina (UTC en producción).
  const today = farmToday();
  const [tab, setTab] = useState<Tab>('summary');
  const [from, setFrom] = useState(addFarmDays(today, -365));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const usesRange = tab === 'summary' || tab === 'by-bull' || tab === 'abortions' || tab === 'synchronization';
  const url = useMemo(() => `/reproduction/reports/${tab}${usesRange ? `?from=${from}&to=${to}` : ''}`, [tab, from, to, usesRange]);

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
    // Sincronización devuelve un objeto, no una lista: lo exportable son las que NO respondieron,
    // que es con lo que el productor sale a revisar vacas.
    const rows: any[] = Array.isArray(data) ? data : tab === 'synchronization' ? (data?.not_responded ?? []) : [];
    let table: (string | number | null)[][] = [];
    if (tab === 'synchronization') {
      table = [['Caravana', 'Nombre', 'Fecha'], ...rows.map((r: any) => [r.tag ?? '', r.name ?? '', r.fecha ?? ''])];
      if (table.length > 1) downloadCsv('reproduccion-sincronizacion.csv', table);
      return;
    }
    if (tab === 'by-bull') table = [['Toro', 'Servicios', 'Concepciones', 'Tasa %'], ...rows.map((r) => [r.tag ?? r.sire_name ?? '', r.services, r.conceptions, r.conception_rate_pct])];
    else if (tab === 'abortions') table = [['Caravana', 'Lote', 'Fecha', 'Causa', 'Edad gest. (d)'], ...rows.map((r) => [r.tag, r.lot ?? '', r.closed_at ? formatDate(r.closed_at) : '', r.loss_cause ?? '', r.loss_gestational_days ?? ''])];
    else table = [['Caravana', 'Lote', 'Días postparto', 'Días abiertos', 'Días desde servicio'], ...rows.map((r) => [r.tag, r.lot ?? '', r.days_postpartum ?? '', r.days_open ?? '', r.days_since_service ?? ''])];
    if (table.length) downloadCsv(`reproduccion-${tab}.csv`, table);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <Link href="/reproduccion" className="mb-1 inline-flex items-center gap-1 text-label text-ink-3 hover:text-ink-2"><ArrowLeft size={13} /> Reproducción</Link>
          <h1 className="text-xl font-semibold">Reportes reproductivos</h1>
        </div>
        {usesRange && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1"><span className="text-compat-10 font-medium text-ink-2">Desde</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} controlSize="sm" fullWidth={false} /></label>
            <label className="flex flex-col gap-1"><span className="text-compat-10 font-medium text-ink-2">Hasta</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} controlSize="sm" fullWidth={false} /></label>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-md border border-subtle p-0.5">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 text-label font-medium ${tab === k ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:text-ink-2'}`}>{l}</button>
          ))}
        </div>
        {tab !== 'summary' && (
          <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-subtle px-3 py-1.5 text-label font-medium text-ink-2 hover:border-strong"><Download size={14} /> CSV</button>
        )}
      </div>

      <div className={cardCls}>
        {loading ? (
          <div className="flex justify-center py-10 text-ink-3"><Loader2 size={18} className="animate-spin" /></div>
        ) : tab === 'summary' ? (
          <Summary s={data} />
        ) : tab === 'synchronization' ? (
          <Synchronization s={data} />
        ) : (
          <ReportTable tab={tab} rows={Array.isArray(data) ? data : []} />
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-heading font-semibold">{value}</div>
      <div className="text-label text-ink-3">{label}</div>
      {hint && <div className="text-caption text-ink-3">{hint}</div>}
    </div>
  );
}

function Summary({ s }: { s: any }) {
  if (!s) return <p className="py-10 text-center text-body text-ink-3">Sin datos.</p>;
  return (
    <div className="grid grid-cols-4 gap-5 max-md:grid-cols-2">
      <Kpi label="Servicios" value={s.services.total} hint={`${s.services.ai} IA · ${s.services.natural} monta · ${s.services.embryo} TE`} />
      <Kpi label="Tasa de concepción" value={pct(s.diagnoses.conception_rate_pct)} hint={`${s.diagnoses.pregnant} preñadas / ${s.diagnoses.pregnant + s.diagnoses.empty} diag.`} />
      <Kpi label="Servicios / concepción" value={s.services_per_conception ?? '—'} />
      <Kpi label="Partos" value={s.calvings.n} hint={`${s.calvings.live} vivas · ${s.calvings.dead} muertas`} />
      <Kpi label="Abortos y pérdidas" value={s.abortions} />
      <Kpi label="Destetes" value={s.weanings.n} hint={`${s.weanings.avg_weight_kg ?? '—'} kg · tasa ${pct(s.weanings.rate_pct)}`} />
      {/*
        El guion NO alcanza cuando hay historial cargado: si los intervalos se descartaron por
        imposibles, el productor tiene que saberlo — es la señal de que hay fechas de parto mal y
        dónde ir a arreglarlas. Antes se promediaban y salía «30 d», que se lee como una vaca
        extraordinaria.
      */}
      <Kpi
        label="Intervalo entre partos"
        value={s.avg_calving_interval_days != null ? `${s.avg_calving_interval_days} d` : '—'}
        hint={
          s.calving_interval_excluded
            ? `${s.calving_interval_excluded} ${s.calving_interval_excluded === 1 ? 'intervalo imposible' : 'intervalos imposibles'} sin contar — revisá las fechas de parto`
            : undefined
        }
      />
      <Kpi label="Días abiertos (prom.)" value={s.avg_days_open != null ? `${s.avg_days_open} d` : '—'} />
    </div>
  );
}

/**
 * Respuesta a la sincronización de receptoras.
 *
 * El número grande es **receptoras por embrión**, no el porcentaje: es la cuenta que el productor
 * hace antes de la próxima jornada. Con 20 embriones y 1,6 receptoras por embrión hacen falta 32
 * vacas preparadas, no 20 — y ésa es la decisión que este reporte existe para informar.
 *
 * Cuando la muestra es chica no se muestra un porcentaje inventado: se muestran los conteos crudos
 * y el motivo. Un número que salta treinta puntos por un animal invita a decidir sobre ruido.
 */
function Synchronization({ s }: { s: any }) {
  if (!s) return <p className="py-10 text-center text-body text-ink-3">Sin datos.</p>;
  const sinRespuesta: any[] = s.not_responded ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-5 max-md:grid-cols-2">
        <Kpi
          label="Receptoras por embrión"
          value={s.recipientsPerEmbryo ?? '—'}
          hint={s.recipientsPerEmbryo ? 'a preparar para colocar uno' : 'todavía no se puede estimar'}
        />
        <Kpi label="Tasa de respuesta" value={pct(s.ratePct)} />
        <Kpi label="Revisadas" value={s.checked} hint={`${s.responded} respondieron · ${s.notResponded} no`} />
        <Kpi label="Sin cuerpo lúteo" value={s.notResponded} hint="no aptas para transferir" />
      </div>

      {s.caveat && <p className="text-label text-ink-3">{s.caveat}</p>}

      {sinRespuesta.length > 0 && (
        <div>
          <p className="mb-2 text-label font-medium">Las que no respondieron</p>
          <p className="mb-2 text-caption text-ink-3">
            Para mirarlas: condición corporal, si venían en anestro, si conviene volver a sincronizarlas.
          </p>
          <table className="w-full text-body">
            <thead>
              {/* Tres columnas de TEXTO: sin separación explícita los encabezados se pegan entre sí.
                  Las otras tablas del archivo no lo necesitan porque sus columnas numéricas van
                  alineadas a la derecha y se separan solas. */}
              <tr className={th}>
                <th className="pr-6">Caravana</th>
                <th className="pr-6">Nombre</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {sinRespuesta.map((r) => (
                <tr key={`${r.animal_id}-${r.fecha}`} className={td}>
                  <td className="tnum pr-6 font-medium">{r.tag ?? '—'}</td>
                  <td className="pr-6 text-ink-2">{r.name ?? '—'}</td>
                  <td className="text-ink-2">{r.fecha ? formatDate(r.fecha) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportTable({ tab, rows }: { tab: Tab; rows: any[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-body text-ink-3">Sin datos.</p>;
  if (tab === 'by-bull') return (
    <table className="w-full text-body"><thead><tr className={th}><th>Toro</th><th className="text-right">Servicios</th><th className="text-right">Concepciones</th><th className="text-right">Tasa</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.sire_id} className={td}><td className="font-medium">{r.tag ?? r.sire_name ?? '—'}</td><td className="tnum text-right">{r.services}</td><td className="tnum text-right">{r.conceptions}</td><td className="tnum text-right">{pct(r.conception_rate_pct)}</td></tr>
      ))}</tbody></table>
  );
  if (tab === 'abortions') return (
    <table className="w-full text-body"><thead><tr className={th}><th>Caravana</th><th>Lote</th><th>Fecha</th><th>Causa</th><th className="text-right">Edad gest.</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className={td}><td className="tnum font-medium">{r.tag ?? '—'}</td><td className="text-ink-2">{r.lot ?? '—'}</td><td className="text-ink-2">{r.closed_at ? formatDate(r.closed_at) : '—'}</td><td className="text-ink-2">{r.loss_cause ?? '—'}</td><td className="tnum text-right">{r.loss_gestational_days != null ? `${r.loss_gestational_days} d` : '—'}</td></tr>
      ))}</tbody></table>
  );
  // open / repeat / diagnosis-pending (filas del estado del rodeo)
  return (
    <table className="w-full text-body"><thead><tr className={th}><th>Caravana</th><th>Lote</th><th className="text-right">Postparto</th><th className="text-right">Abiertos</th><th className="text-right">Desde servicio</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.animal_id} className={td}><td className="tnum font-medium">{r.tag ?? '—'}</td><td className="text-ink-2">{r.lot ?? '—'}</td><td className="tnum text-right text-ink-2">{r.days_postpartum != null ? `${r.days_postpartum} d` : '—'}</td><td className="tnum text-right text-ink-2">{r.days_open != null ? `${r.days_open} d` : '—'}</td><td className="tnum text-right text-ink-2">{r.days_since_service != null ? `${r.days_since_service} d` : '—'}</td></tr>
      ))}</tbody></table>
  );
}
