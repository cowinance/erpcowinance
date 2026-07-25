'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState, KpiCard } from '@/components/ui';
import { Input } from '@/components/Input';
import { downloadCsv } from '@/lib/csv';

/**
 * Pantalla de costos (G2 · E5). Cuatro pestañas sobre los cuatro endpoints del módulo, con un rango
 * de fechas compartido: el productor elige el período UNA vez y todas las vistas hablan de él.
 *
 * Criterio de presentación heredado del backend: un `null` NO se pinta como 0. Un margen sin ventas
 * o un costo unitario sin producción se muestran como «—», porque cero significaría «gratis» o
 * «rentabilidad total» y las dos lecturas son falsas. Donde el backend manda `note`, se muestra:
 * casi siempre dice qué falta cargar.
 */

type Tab = 'profit' | 'unit' | 'centers' | 'budget';

interface Activity {
  reference_id: string;
  name: string;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number | null;
  roi_pct: number | null;
  output: number;
  output_unit: string;
  unit_cost: number | null;
  margin_per_unit: number | null;
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
/** Importes unitarios: dos decimales, porque $4,96 el kilo y $5 el kilo no son lo mismo. */
const unitMoney = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits });
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`);
const toneOf = (n: number | null | undefined) => (n == null ? 'text-ink-3' : n > 0 ? 'text-success' : n < 0 ? 'text-danger' : '');

const TABS: { key: Tab; label: string }[] = [
  { key: 'profit', label: 'Rentabilidad' },
  { key: 'unit', label: 'Costo unitario' },
  { key: 'centers', label: 'Costos por centro' },
  { key: 'budget', label: 'Vs presupuesto' },
];

const CENTER_LEVELS = [
  { key: 'lot', label: 'Lote' },
  { key: 'animal', label: 'Animal' },
  { key: 'crop', label: 'Cultivo' },
  { key: 'machinery', label: 'Máquina' },
];
const CATEGORY_LABEL: Record<string, string> = { health: 'Sanidad', feed: 'Nutrición', crop: 'Agricultura', machinery: 'Maquinaria', labor: 'Mano de obra' };

export function CostingView({
  initialProfit,
  initialUnit,
  budgets,
}: {
  initialProfit: any;
  initialUnit: any;
  budgets: { id: string; name: string; fiscal_year: number }[];
}) {
  const [tab, setTab] = useState<Tab>('profit');
  const [from, setFrom] = useState<string>(initialProfit?.from ?? '');
  const [to, setTo] = useState<string>(initialProfit?.to ?? '');

  const [profit, setProfit] = useState<any>(initialProfit);
  const [profitLevel, setProfitLevel] = useState<'activity' | 'lot' | 'animal'>('activity');
  const [unit, setUnit] = useState<any>(initialUnit);
  const [centers, setCenters] = useState<any>(null);
  const [centerLevel, setCenterLevel] = useState('lot');
  const [budgetId, setBudgetId] = useState<string>(budgets[0]?.id ?? '');
  const [budgetData, setBudgetData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const range = () => `from=${from}&to=${to}`;
  const get = async (path: string) => {
    const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
  };

  /** Recarga la pestaña visible. Cada vista pide solo lo suyo: no se traen datos que no se ven. */
  async function reload(next: Tab, opts: { profitLevel?: string; centerLevel?: string; budgetId?: string } = {}) {
    setLoading(true);
    try {
      if (next === 'profit') setProfit(await get(`/costs/profitability?level=${opts.profitLevel ?? profitLevel}&${range()}`));
      else if (next === 'unit') setUnit(await get(`/costs/unit?${range()}`));
      else if (next === 'centers') setCenters(await get(`/costs/by-center?level=${opts.centerLevel ?? centerLevel}&${range()}`));
      else if (next === 'budget') {
        const id = opts.budgetId ?? budgetId;
        setBudgetData(id ? await get(`/costs/budget-vs-actual?budget_id=${id}&level=lot&${range()}`) : null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function switchTab(next: Tab) {
    setTab(next);
    // Se carga bajo demanda la primera vez; después queda cacheada hasta que cambie el rango.
    if ((next === 'centers' && !centers) || (next === 'budget' && !budgetData)) await reload(next);
  }

  function exportCsv() {
    if (tab === 'profit') {
      const rows: (string | number | null)[][] = [['Concepto', 'Ingresos', 'Costos', 'Margen', 'Margen %', 'ROI %']];
      for (const r of profit?.rows ?? []) rows.push([r.name, r.revenue, r.cost, r.margin, r.margin_pct, r.roi_pct]);
      rows.push(['TOTAL', profit?.totals?.revenue, profit?.totals?.cost, profit?.totals?.margin, profit?.totals?.margin_pct, profit?.totals?.roi_pct]);
      downloadCsv(`rentabilidad-${from}_${to}.csv`, rows);
    } else if (tab === 'unit') {
      const rows: (string | number | null)[][] = [['Actividad', 'Costo', 'Producción', 'Unidad', 'Costo unitario', 'Costo por ha']];
      for (const a of unit?.activities ?? []) rows.push([a.label, a.cost, a.output, a.output_unit, a.unit_cost, a.cost_per_ha]);
      downloadCsv(`costo-unitario-${from}_${to}.csv`, rows);
    } else if (tab === 'centers') {
      const cats = Object.keys(CATEGORY_LABEL);
      const rows: (string | number | null)[][] = [['Centro', ...cats.map((c) => CATEGORY_LABEL[c]), 'Total']];
      for (const r of centers?.rows ?? []) rows.push([r.name, ...cats.map((c) => r.categories[c]), r.total]);
      downloadCsv(`costos-por-centro-${centerLevel}-${from}_${to}.csv`, rows);
    } else {
      const rows: (string | number | null)[][] = [['Centro de costo', 'Presupuesto', 'Real', 'Desvío', 'Desvío %']];
      for (const r of budgetData?.rows ?? []) rows.push([r.name, r.budget, r.actual, r.variance, r.variance_pct]);
      downloadCsv(`presupuesto-vs-real-${from}_${to}.csv`, rows);
    }
  }

  const hasData =
    (tab === 'profit' && profit?.rows?.length) ||
    (tab === 'unit' && unit?.activities?.length) ||
    (tab === 'centers' && centers?.rows?.length) ||
    (tab === 'budget' && budgetData?.rows?.length);

  return (
    <div className="space-y-4">
      {/* Rango compartido: se elige el período una vez y vale para las cuatro vistas. */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className="text-caption text-ink-3" htmlFor="costs-from">
              Desde
            </label>
            <Input id="costs-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-40">
            <label className="text-caption text-ink-3" htmlFor="costs-to">
              Hasta
            </label>
            <Input id="costs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button
            onClick={() => reload(tab)}
            className="h-9 rounded-md bg-brand px-4 text-body font-medium text-white disabled:opacity-50"
            disabled={loading || !from || !to}
          >
            {loading ? 'Calculando…' : 'Aplicar'}
          </button>
          <button
            onClick={exportCsv}
            className="h-9 rounded-md border border-subtle px-4 text-body font-medium disabled:opacity-50"
            disabled={!hasData}
          >
            Exportar CSV
          </button>
        </div>
      </Card>

      <div className="tab-strip flex gap-1 border-b border-subtle" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium transition-colors ${
              tab === t.key ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profit' && (
        <ProfitTab
          data={profit}
          level={profitLevel}
          onLevel={(l) => {
            setProfitLevel(l);
            reload('profit', { profitLevel: l });
          }}
        />
      )}
      {tab === 'unit' && <UnitTab data={unit} />}
      {tab === 'centers' && (
        <CentersTab
          data={centers}
          level={centerLevel}
          onLevel={(l) => {
            setCenterLevel(l);
            reload('centers', { centerLevel: l });
          }}
        />
      )}
      {tab === 'budget' && (
        <BudgetTab
          data={budgetData}
          budgets={budgets}
          budgetId={budgetId}
          onBudget={(id) => {
            setBudgetId(id);
            reload('budget', { budgetId: id });
          }}
        />
      )}
    </div>
  );
}

/** Rentabilidad: el resumen del módulo. Por actividad suma el costo unitario y el margen por unidad. */
function ProfitTab({ data, level, onLevel }: { data: any; level: string; onLevel: (l: any) => void }) {
  const t = data?.totals;
  if (!data) return <EmptyState title="Sin datos de rentabilidad" body="Elegí un período y tocá «Aplicar»." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <KpiCard label="Ingresos" value={money(t?.revenue)} />
        <KpiCard label="Costos" value={money(t?.cost)} />
        <KpiCard
          label="Margen"
          value={money(t?.margin)}
          hint={t?.margin_pct == null ? 'Sin ventas en el período' : `${pct(t.margin_pct)} sobre ventas`}
          tone={t?.margin > 0 ? 'success' : t?.margin < 0 ? 'danger' : undefined}
        />
        <KpiCard label="Retorno" value={pct(t?.roi_pct)} hint="Sobre lo invertido" />
      </div>

      <Card>
        <CardTitle
          action={
            <div className="flex gap-1">
              {[
                { key: 'activity', label: 'Por actividad' },
                { key: 'lot', label: 'Por lote' },
                { key: 'animal', label: 'Por animal' },
              ].map((o) => (
                <button
                  key={o.key}
                  onClick={() => onLevel(o.key)}
                  className={`rounded-md px-2.5 py-1 text-label font-medium ${level === o.key ? 'bg-brand-soft text-ink' : 'text-ink-3 hover:bg-sunken'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          }
        >
          Margen
        </CardTitle>
        {data.rows.length === 0 ? (
          <EmptyState title="Sin movimientos en el período" body="No hay ventas ni costos cargados en el rango elegido." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-caption text-ink-3">
                <tr className="border-b border-subtle text-left">
                  <th className="py-2 font-medium">Concepto</th>
                  <th className="py-2 text-right font-medium">Ingresos</th>
                  <th className="py-2 text-right font-medium">Costos</th>
                  <th className="py-2 text-right font-medium">Margen</th>
                  <th className="py-2 text-right font-medium">Margen %</th>
                  {level === 'activity' && <th className="py-2 text-right font-medium">Margen / unidad</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: Activity, i: number) => (
                  <tr key={r.reference_id ?? i} className="border-b border-subtle last:border-0">
                    <td className="py-2">{r.name}</td>
                    <td className="tnum py-2 text-right">{money(r.revenue)}</td>
                    <td className="tnum py-2 text-right">{money(r.cost)}</td>
                    <td className={`tnum py-2 text-right font-medium ${toneOf(r.margin)}`}>{money(r.margin)}</td>
                    <td className={`tnum py-2 text-right ${toneOf(r.margin_pct)}`}>{pct(r.margin_pct)}</td>
                    {level === 'activity' && (
                      <td className={`tnum py-2 text-right ${toneOf(r.margin_per_unit)}`}>
                        {r.margin_per_unit == null ? '—' : `${unitMoney(r.margin_per_unit)} / ${r.output_unit}`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Costo unitario: una tarjeta por actividad, con la nota del backend cuando falta clasificar algo. */
function UnitTab({ data }: { data: any }) {
  if (!data) return <EmptyState title="Sin datos" body="Elegí un período y tocá «Aplicar»." />;
  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {data.activities.map((a: any) => (
        <Card key={a.activity}>
          <CardTitle>{a.label}</CardTitle>
          <div className="tnum text-display leading-9 font-semibold">
            {a.unit_cost == null ? '—' : unitMoney(a.unit_cost)}
            {a.unit_cost != null && <span className="ml-1 text-body font-normal text-ink-2">/ {a.output_unit}</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-caption text-ink-3">Costo total</div>
              <div className="tnum text-body font-medium">{money(a.cost)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-3">Producción</div>
              <div className="tnum text-body font-medium">
                {num(a.output, 1)} <span className="text-caption font-normal text-ink-3">{a.output_unit}</span>
              </div>
            </div>
            {a.cost_per_ha != null && (
              <div>
                <div className="text-caption text-ink-3">Costo por hectárea</div>
                <div className="tnum text-body font-medium">{unitMoney(a.cost_per_ha)} / ha</div>
              </div>
            )}
          </div>
          {/* La nota explica por qué no hay unitario: casi siempre falta clasificar, no es «gratis». */}
          {a.note && <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-label text-ink-2">{a.note}</p>}
        </Card>
      ))}
    </div>
  );
}

/** Costos por centro: el desglose por categoría, para saber en qué se fue la plata. */
function CentersTab({ data, level, onLevel }: { data: any; level: string; onLevel: (l: string) => void }) {
  const cats = Object.keys(CATEGORY_LABEL);
  return (
    <Card>
      <CardTitle
        action={
          <div className="flex gap-1">
            {CENTER_LEVELS.map((o) => (
              <button
                key={o.key}
                onClick={() => onLevel(o.key)}
                className={`rounded-md px-2.5 py-1 text-label font-medium ${level === o.key ? 'bg-brand-soft text-ink' : 'text-ink-3 hover:bg-sunken'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      >
        Costos por centro
      </CardTitle>
      {!data?.rows?.length ? (
        <EmptyState title="Sin costos en el período" body="No hay tratamientos, entregas de ración, labores ni gastos de maquinaria en el rango." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="text-caption text-ink-3">
              <tr className="border-b border-subtle text-left">
                <th className="py-2 font-medium">Centro</th>
                {cats.map((c) => (
                  <th key={c} className="py-2 text-right font-medium">
                    {CATEGORY_LABEL[c]}
                  </th>
                ))}
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.reference_id} className="border-b border-subtle last:border-0">
                  <td className="py-2">{r.name}</td>
                  {cats.map((c) => (
                    <td key={c} className="tnum py-2 text-right text-ink-2">
                      {r.categories[c] > 0 ? money(r.categories[c]) : '—'}
                    </td>
                  ))}
                  <td className="tnum py-2 text-right font-medium">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-body font-medium">
              <tr className="border-t border-subtle">
                <td className="py-2">Total</td>
                {cats.map((c) => (
                  <td key={c} className="tnum py-2 text-right">
                    {money(data.totals.by_category[c])}
                  </td>
                ))}
                <td className="tnum py-2 text-right">{money(data.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {/* Mano de obra que no llegó a ninguna fila (G2 · E6). Callarlo abarataría el costo en silencio. */}
      {(data?.totals?.unattributed_labor > 0 || data?.totals?.unpriced_hours > 0) && (
        <div className="mt-3 space-y-1">
          {data.totals.unattributed_labor > 0 && (
            <p className="rounded-md bg-sunken px-3 py-2 text-label text-ink-2">
              Hay {money(data.totals.unattributed_labor)} de jornales sin imputar a un centro. Asignales un centro de costo o
              vinculá el parte de trabajo a una tarea para que sumen acá.
            </p>
          )}
          {data.totals.unpriced_hours > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-label text-ink-2">
              {num(data.totals.unpriced_hours, 1)} horas trabajadas por empleados sin tarifa horaria: ese costo real todavía no
              está contado. Cargá la tarifa en Personal.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Vs presupuesto: el sobregiro primero, que es lo que hay que mirar hoy. */
function BudgetTab({
  data,
  budgets,
  budgetId,
  onBudget,
}: {
  data: any;
  budgets: { id: string; name: string; fiscal_year: number }[];
  budgetId: string;
  onBudget: (id: string) => void;
}) {
  if (budgets.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay presupuestos"
        body="Cargá un presupuesto en Finanzas e imputá sus líneas a centros de costo para comparar contra el gasto real."
        actionHref="/finanzas"
        actionLabel="Ir a Finanzas"
      />
    );
  }
  return (
    <Card>
      <CardTitle
        action={
          <select
            value={budgetId}
            onChange={(e) => onBudget(e.target.value)}
            aria-label="Presupuesto"
            className="h-8 rounded-md border border-subtle bg-surface px-2 text-body"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.fiscal_year})
              </option>
            ))}
          </select>
        }
      >
        Real vs presupuesto
      </CardTitle>

      {!data?.rows?.length ? (
        <EmptyState
          title="Este presupuesto no tiene líneas por centro de costo"
          body="Las líneas del presupuesto tienen que imputarse a un centro de costo (lote, animal, cultivo o máquina) para poder compararlas contra el gasto real."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-caption text-ink-3">
                <tr className="border-b border-subtle text-left">
                  <th className="py-2 font-medium">Centro de costo</th>
                  <th className="py-2 text-right font-medium">Presupuesto</th>
                  <th className="py-2 text-right font-medium">Real</th>
                  <th className="py-2 text-right font-medium">Desvío</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.cost_center_id} className="border-b border-subtle last:border-0">
                    <td className="py-2">
                      {r.name}
                      {r.over_budget && (
                        <span className="ml-2 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">
                          Sobregiro
                        </span>
                      )}
                    </td>
                    <td className="tnum py-2 text-right text-ink-2">{money(r.budget)}</td>
                    <td className="tnum py-2 text-right">{money(r.actual)}</td>
                    {/* En un gasto, desvío positivo = se pasó: rojo. Negativo = bajo presupuesto. */}
                    <td className={`tnum py-2 text-right font-medium ${r.variance > 0 ? 'text-danger' : 'text-success'}`}>
                      {money(r.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.totals.unbudgeted_actual > 0 && (
            <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-label text-ink-2">
              Además se gastaron {money(data.totals.unbudgeted_actual)} en centros sin presupuesto asignado.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
