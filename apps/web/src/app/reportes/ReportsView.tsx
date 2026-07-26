'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

type ReportKey = 'summary' | 'inventory' | 'movements' | 'production' | 'reproduction' | 'health';

const REPORTS: { key: ReportKey; label: string }[] = [
  // Primero el resumen: es el que contesta «¿cómo anduvo la finca?», que es la pregunta con la que
  // alguien entra a Reportes. Los demás son el detalle de una parte.
  { key: 'summary', label: 'Resumen de la finca' },
  { key: 'inventory', label: 'Inventario a fecha' },
  { key: 'movements', label: 'Altas y bajas' },
  { key: 'production', label: 'Producción' },
  { key: 'reproduction', label: 'Reproducción' },
  { key: 'health', label: 'Sanidad' },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86400000).toISOString().slice(0, 10);

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

export function ReportsView() {
  const [tab, setTab] = useState<ReportKey>('summary');
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
        tab === 'summary'
          ? `farm-summary?from=${from}&to=${to}`
          : tab === 'inventory'
          ? `herd-inventory?at=${at}&group_by=${groupBy}`
          : tab === 'movements'
            ? `herd-movements?from=${from}&to=${to}`
            : tab === 'production'
              ? `production?from=${from}&to=${to}`
              : tab === 'reproduction'
                ? `reproduction?from=${from}&to=${to}`
                : `health?from=${from}&to=${to}`;
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
    if (forTab === 'summary') {
      name = `resumen-finca-${data.from}_${data.to}.csv`;
      rows = [
        ['Bloque', 'Concepto', 'Valor'],
        ['Hacienda', 'Cabezas', data.hacienda?.total ?? ''],
        ['Producción', 'Pesajes', data.produccion?.pesajes ?? ''],
        ['Producción', 'GDP promedio (kg/d)', data.produccion?.gdp_promedio ?? ''],
        ['Economía', 'Ingresos', data.economia?.ingresos ?? ''],
        ['Economía', 'Costos', data.economia?.costos ?? ''],
        ['Economía', 'Margen', data.economia?.margen ?? ''],
        ['Mano de obra', 'Costo', data.mano_de_obra?.costo ?? ''],
        ['Mano de obra', 'Horas', data.mano_de_obra?.horas ?? ''],
        ['Inventario', 'Valor del stock', data.inventario?.valor ?? ''],
        ['Inventario', 'Plata quieta', data.inventario?.plata_quieta ?? ''],
        ['Maquinaria', 'Costo total', data.maquinaria?.costo_total ?? ''],
        ['Sanidad', 'Vacunaciones', data.sanidad?.vacunaciones?.total ?? ''],
        ['Sanidad', 'Tratamientos', data.sanidad?.tratamientos?.total ?? ''],
        ['Sanidad', 'Muertes', data.sanidad?.mortalidad?.n ?? ''],
        ['Reproducción', 'Servicios', data.reproduccion?.servicios?.total ?? ''],
        ['Reproducción', '% preñez', data.reproduccion?.indices?.prenez_pct ?? ''],
      ];
    } else if (forTab === 'inventory') {
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
    } else if (forTab === 'reproduction') {
      name = `reproduccion-${data.from}_${data.to}.csv`;
      rows = [
        ['Concepto', 'Cantidad'],
        ['Inseminaciones', data.servicios.ia],
        ['Montas', data.servicios.monta],
        ['Transf. embrionaria', data.servicios.te ?? 0],
        ['Total servicios', data.servicios.total],
        ['Diagnósticos positivos', data.diagnosticos.positivos],
        ['Diagnósticos negativos', data.diagnosticos.negativos],
        ['% Preñez (período)', data.indices?.prenez_pct ?? ''],
        ['IEP (días)', data.indices?.iep_dias ?? ''],
        ['Servicios por preñez', data.indices?.servicios_por_prenez ?? ''],
        ['Partos', data.partos],
        ['Crías nacidas', data.crias_nacidas],
        ['Destetes', data.destetes.n],
      ];
    } else if (forTab === 'health') {
      name = `sanidad-${data.from}_${data.to}.csv`;
      rows = [
        ['Concepto', 'Cantidad'],
        ['Vacunaciones', data.vacunaciones.total],
        ['Tratamientos', data.tratamientos.total],
        ['Muertes', data.mortalidad.n],
        ['Pérdida estimada', data.mortalidad.perdida_estimada],
        ['Tasa mortalidad (%)', data.mortalidad.tasa_pct ?? ''],
        [],
        ['Vacunas por producto', ''],
        ...(data.vacunaciones.por_producto ?? []).map((r: any) => [r.producto, r.n]),
        [],
        ['Tratamientos por vía', ''],
        ...(data.tratamientos.por_via ?? []).map((r: any) => [r.via, r.n]),
      ];
    }
    downloadCsv(name, rows);
  }

  return (
    <div>
      {/* Selector de reporte */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="tab-strip flex gap-1 rounded-md bg-sunken p-1">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setTab(r.key)}
              className={`h-8 shrink-0 whitespace-nowrap rounded px-3 text-body font-medium ${
                tab === r.key ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="md" onClick={exportCsv} disabled={!data} className="gap-1.5">
          <Download size={15} aria-hidden="true" /> Exportar CSV
        </Button>
      </div>

      {/* Filtros de fecha */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {tab === 'inventory' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink-2">A la fecha</span>
              <Input type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} controlSize="md" fullWidth={false} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink-2">Agrupar por</span>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} controlSize="md" fullWidth={false}>
                <option value="category">Categoría</option>
                <option value="lot">Lote</option>
                <option value="sex">Sexo</option>
              </Select>
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink-2">Desde</span>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} controlSize="md" fullWidth={false} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink-2">Hasta</span>
              <Input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} controlSize="md" fullWidth={false} />
            </label>
          </>
        )}
      </div>

      {loading ? (
        <div className={`${cardCls} flex items-center justify-center py-16 text-ink-3`}>
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : error ? (
        <div className={`${cardCls} py-10 text-center text-body text-danger`}>{error}</div>
      ) : (
        result && (
          <>
            {result.forTab === 'summary' && <FarmSummary data={result.payload} />}
            {result.forTab === 'inventory' && <InventoryReport data={result.payload} />}
            {result.forTab === 'movements' && <MovementsReport data={result.payload} />}
            {result.forTab === 'production' && <ProductionReport data={result.payload} />}
            {result.forTab === 'reproduction' && <ReproductionReport data={result.payload} />}
            {result.forTab === 'health' && <HealthReport data={result.payload} />}
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
          <div className="text-body text-ink-2">Existencias al {new Date(data.at).toLocaleDateString('es-AR')}</div>
          <div className="text-caption text-ink-3">reconstruido por el ciclo de vida de cada animal</div>
        </div>
        <div className="tnum text-display font-semibold">
          {data.total}
          <span className="ml-1.5 text-body font-normal text-ink-2">cabezas</span>
        </div>
      </div>
      <div className="space-y-2">
        {data.rows.map((r: any) => (
          <div key={r.grupo} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-body text-ink-2">{r.grupo}</div>
            <div className="h-5 flex-1 overflow-hidden rounded-sm bg-sunken">
              <div className="h-full rounded-sm bg-brand-300" style={{ width: `${(r.n / max) * 100}%` }} />
            </div>
            <div className="tnum w-10 text-right text-body font-medium">{r.n}</div>
          </div>
        ))}
        {data.rows.length === 0 && <p className="py-6 text-center text-body text-ink-3">Sin animales a esa fecha.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-md bg-sunken p-3">
      <div className="text-caption text-ink-3">{label}</div>
      <div
        className={`tnum text-compat-22 font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : ''}`}
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
      <div className="mb-3 text-body text-ink-2">
        {data.total_pesajes} pesajes registrados en el período
      </div>
      {data.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin pesajes en el período.</p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
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
  const ix = data.indices ?? {};
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
  const diag = data.diagnosticos ?? { positivos: 0, negativos: 0, total: 0 };
  return (
    <div className="space-y-4">
      {/* Índices del período (P9-1). El «% vientres preñados» (snapshot a-fecha) vive en la
          página de Reproducción, no acá. */}
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">% Preñez</div>
          <div className="tnum text-compat-26 font-semibold">{pct(ix.prenez_pct)}</div>
          <div className="mt-1 text-label text-ink-3">
            {diag.positivos}/{diag.total} diagnósticos del período
          </div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">IEP</div>
          <div className="tnum text-compat-26 font-semibold">
            {ix.iep_dias != null ? ix.iep_dias : '—'}
            <span className="text-label text-ink-3"> días</span>
          </div>
          <div className="mt-1 text-label text-ink-3">intervalo entre partos</div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Servicios / preñez</div>
          <div className="tnum text-compat-26 font-semibold">{ix.servicios_por_prenez != null ? ix.servicios_por_prenez : '—'}</div>
          <div className="mt-1 text-label text-ink-3">eficiencia del período</div>
        </div>
      </div>
      <p className="text-label text-ink-3">Indicadores calculados sobre el período filtrado.</p>

      {/* Conteos del ciclo */}
      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Servicios</div>
          <div className="tnum text-compat-26 font-semibold">{data.servicios.total}</div>
          <div className="mt-1 text-label text-ink-3">
            {data.servicios.ia} IA · {data.servicios.monta} monta{data.servicios.te ? ` · ${data.servicios.te} TE` : ''}
          </div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Diagnósticos</div>
          <div className="tnum text-compat-26 font-semibold">{diag.total}</div>
          <div className="mt-1 text-label text-ink-3">
            {diag.positivos} preñadas · {diag.negativos} vacías
          </div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Partos</div>
          <div className="tnum text-compat-26 font-semibold">{data.partos}</div>
          <div className="mt-1 text-label text-ink-3">{data.crias_nacidas} crías nacidas</div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Destetes</div>
          <div className="tnum text-compat-26 font-semibold">{data.destetes.n}</div>
          <div className="mt-1 text-label text-ink-3">
            {data.destetes.peso_promedio ? `${data.destetes.peso_promedio} kg prom.` : 'sin peso'}
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthReport({ data }: { data: any }) {
  const mort = data.mortalidad ?? { n: 0, perdida_estimada: 0, tasa_pct: null };
  const vacProd: any[] = data.vacunaciones?.por_producto ?? [];
  const treatVia: any[] = data.tratamientos?.por_via ?? [];
  const money = (v: number) => `$${Math.round(v).toLocaleString('es-AR')}`;
  return (
    <div className="space-y-4">
      {/* Indicadores del período */}
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Vacunaciones</div>
          <div className="tnum text-compat-26 font-semibold">{data.vacunaciones?.total ?? 0}</div>
          <div className="mt-1 text-label text-ink-3">aplicadas en el período</div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Tratamientos</div>
          <div className="tnum text-compat-26 font-semibold">{data.tratamientos?.total ?? 0}</div>
          <div className="mt-1 text-label text-ink-3">aplicados en el período</div>
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Mortalidad</div>
          <div className="tnum text-compat-26 font-semibold">
            {mort.n}
            {mort.tasa_pct != null ? <span className="text-label text-ink-3"> · {mort.tasa_pct}%</span> : null}
          </div>
          <div className="mt-1 text-label text-ink-3">{mort.perdida_estimada ? `${money(mort.perdida_estimada)} pérdida est.` : 'muertes en el período'}</div>
        </div>
      </div>

      {/* Desgloses */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Vacunas por producto</div>
          {vacProd.length === 0 ? (
            <p className="py-4 text-center text-label text-ink-3">Sin vacunaciones en el período.</p>
          ) : (
            <div className="space-y-1">
              {vacProd.map((r) => (
                <div key={r.producto} className="flex justify-between text-body">
                  <span className="truncate">{r.producto}</span>
                  <span className="tnum font-semibold">{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={cardCls}>
          <div className="mb-2 text-body font-semibold">Tratamientos por vía</div>
          {treatVia.length === 0 ? (
            <p className="py-4 text-center text-label text-ink-3">Sin tratamientos en el período.</p>
          ) : (
            <div className="space-y-1">
              {treatVia.map((r) => (
                <div key={r.via} className="flex justify-between text-body">
                  <span className="uppercase">{r.via}</span>
                  <span className="tnum font-semibold">{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-label text-ink-3">Indicadores del período. La cobertura de vacunación y los animales en retiro (a la fecha) viven en el panel de Alertas.</p>
    </div>
  );
}

const money = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const qty = (n: number | null | undefined, digits = 0) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

const ACTIVIDAD_ES: Record<string, string> = {
  health: 'Sanidad',
  breeding: 'Reproducción',
  feeding: 'Alimentación',
  maintenance: 'Mantenimiento',
  crop: 'Agricultura',
  general: 'General',
};

/**
 * Resumen de la finca (Fase 5): el cierre que ensambla el ERP.
 *
 * Cada bloque muestra el mismo número que la pantalla de su módulo, porque el backend COMPONE esos
 * servicios en vez de rehacer sus consultas. Por eso cada tarjeta dice de dónde viene: quien
 * necesita el detalle sabe adónde ir, y el resumen no compite con el módulo por ser la fuente.
 *
 * Un bloque sin datos se muestra vacío y con su motivo. Rellenarlo con ceros haría que una finca
 * que todavía no usa Maquinaria lea «gastó 0», que es una afirmación y no una ausencia.
 */
function FarmSummary({ data }: { data: any }) {
  const bloques: { titulo: string; href: string; vacio: string; contenido: React.ReactNode | null }[] = [
    {
      titulo: 'Economía',
      href: '/costos',
      vacio: 'Sin costos ni ventas en el período.',
      contenido: data.economia && (
        <>
          <Row label="Ingresos" value={money(data.economia.ingresos)} />
          <Row label="Costos" value={money(data.economia.costos)} />
          <Row label="Margen" value={money(data.economia.margen)} tone={data.economia.margen < 0 ? 'danger' : 'success'} />
          {data.economia.caveat && <p className="mt-2 text-caption text-warning">{data.economia.caveat}</p>}
        </>
      ),
    },
    {
      titulo: 'Hacienda',
      href: '/animales',
      vacio: 'Sin animales cargados.',
      contenido: data.hacienda && (
        <>
          <Row label="Cabezas" value={qty(data.hacienda.total)} />
          {(data.hacienda.by ?? []).slice(0, 3).map((r: any) => (
            <Row key={r.grupo} label={r.grupo} value={qty(r.n)} muted />
          ))}
        </>
      ),
    },
    {
      titulo: 'Producción',
      href: '/produccion',
      vacio: 'Sin pesajes en el período.',
      contenido: data.produccion && (
        <>
          <Row label="Pesajes" value={qty(data.produccion.pesajes)} />
          <Row label="GDP promedio" value={data.produccion.gdp_promedio == null ? '—' : `${qty(data.produccion.gdp_promedio, 3)} kg/d`} />
        </>
      ),
    },
    {
      titulo: 'Reproducción',
      href: '/reproduccion',
      vacio: 'Sin servicios en el período.',
      contenido: data.reproduccion && (
        <>
          <Row label="Servicios" value={qty(data.reproduccion.servicios?.total)} />
          <Row label="Preñez" value={data.reproduccion.indices?.prenez_pct == null ? '—' : `${qty(data.reproduccion.indices.prenez_pct, 1)}%`} />
          <Row label="Partos" value={qty(data.reproduccion.partos)} muted />
        </>
      ),
    },
    {
      titulo: 'Sanidad',
      href: '/sanidad',
      vacio: 'Sin eventos sanitarios en el período.',
      contenido: data.sanidad && (
        <>
          <Row label="Vacunaciones" value={qty(data.sanidad.vacunaciones?.total)} />
          <Row label="Tratamientos" value={qty(data.sanidad.tratamientos?.total)} />
          <Row label="Muertes" value={qty(data.sanidad.mortalidad?.n)} tone={data.sanidad.mortalidad?.n > 0 ? 'danger' : undefined} />
        </>
      ),
    },
    {
      titulo: 'Mano de obra',
      href: '/costos',
      vacio: 'Sin partes de trabajo en el período.',
      contenido: data.mano_de_obra && (
        <>
          <Row label="Costo" value={money(data.mano_de_obra.costo)} />
          <Row label="Horas" value={qty(data.mano_de_obra.horas, 1)} />
          {data.mano_de_obra.principal && (
            <Row label="Se va en" value={ACTIVIDAD_ES[data.mano_de_obra.principal.activity] ?? data.mano_de_obra.principal.activity} muted />
          )}
        </>
      ),
    },
    {
      titulo: 'Inventario',
      href: '/inventario',
      vacio: 'Sin insumos cargados.',
      contenido: data.inventario && (
        <>
          <Row label="Valor del stock" value={money(data.inventario.valor)} />
          <Row label="Plata quieta" value={money(data.inventario.plata_quieta)} tone={data.inventario.plata_quieta > 0 ? 'danger' : undefined} />
          <Row label="No llegan a reponerse" value={qty(data.inventario.items_criticos)} muted />
        </>
      ),
    },
    {
      titulo: 'Maquinaria',
      href: '/maquinaria',
      vacio: 'Sin máquinas ni cargas en el período.',
      contenido: data.maquinaria && (
        <>
          <Row label="Costo de uso" value={money(data.maquinaria.costo_total)} />
          <Row label="Combustible" value={money(data.maquinaria.combustible)} muted />
          {data.maquinaria.mas_cara && <Row label="La más cara" value={data.maquinaria.mas_cara.name} muted />}
        </>
      ),
    },
    {
      titulo: 'Agricultura',
      href: '/agricultura',
      vacio: 'Sin cultivos en el período.',
      contenido: data.agricultura && (
        <>
          {data.agricultura.por_cultivo.slice(0, 3).map((c: any) => (
            <Row key={c.cropType} label={c.cropType} value={`${qty(c.meanYieldPerHa)}/ha`} raw />
          ))}
        </>
      ),
    },
    {
      titulo: 'Pastoreo',
      href: '/pastoreo',
      vacio: 'Sin pastoreos cerrados con pesajes.',
      contenido: data.pastoreo && (
        <>
          <Row label="Mejor potrero" value={data.pastoreo.mejor.paddock_name} />
          <Row label="kg/ha/día" value={qty(data.pastoreo.mejor.gainKgPerHaPerDay, 2)} muted />
          <Row label="Más flojo" value={data.pastoreo.peor.paddock_name} muted />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <p className="text-body text-ink-2">
          Cómo anduvo la finca entre <span className="tnum font-medium">{data.from}</span> y <span className="tnum font-medium">{data.to}</span>.
        </p>
        <p className="mt-1 text-label text-ink-3">
          Cada bloque trae el mismo número que su módulo: este resumen los compone, no los vuelve a calcular. Entrá al módulo para el detalle.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {bloques.map((b) => (
          <div key={b.titulo} className={cardCls}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-body font-semibold">{b.titulo}</h3>
              <a href={b.href} className="text-caption font-medium text-brand hover:underline">
                ver →
              </a>
            </div>
            {b.contenido ?? <p className="text-label text-ink-3">{b.vacio}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * `capitalize` va SOLO donde la etiqueta viene de un dato crudo (el tipo de cultivo). Aplicado a
 * toda etiqueta convierte «GDP promedio» en «GDP Promedio» y «no llegan a reponerse» en «No Llegan
 * A Reponerse»: title case en castellano se lee como error de traducción.
 */
function Row({ label, value, tone, muted, raw }: { label: string; value: string | number; tone?: 'success' | 'danger'; muted?: boolean; raw?: boolean }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : muted ? 'text-ink-3' : 'text-ink-1';
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className={`text-label ${muted ? 'text-ink-3' : 'text-ink-2'} ${raw ? 'capitalize' : ''}`}>{label}</span>
      <span className={`tnum text-body font-medium ${color}`}>{value}</span>
    </div>
  );
}
