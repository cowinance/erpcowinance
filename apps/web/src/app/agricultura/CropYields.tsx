'use client';

import { Card, CardTitle } from '@/components/ui';

interface CropRow {
  cropId: string;
  cropType: string;
  paddock_name: string | null;
  variety: string | null;
  status: string | null;
  areaHa: number | null;
  harvested: number | null;
  yield_unit: string | null;
  cost: number | null;
  yieldPerHa: number | null;
  costPerHa: number | null;
  costPerUnit: number | null;
  yieldIndex: number | null;
  revenue: number | null;
  margin: number | null;
  marginPerHa: number | null;
  price_used: number | null;
  caveat: string | null;
}
export interface CropYieldReport {
  from: string;
  to: string;
  crops: CropRow[];
  by_type: { cropType: string; crops: number; areaHa: number; meanYieldPerHa: number | null; totalCost: number; totalMargin: number | null }[];
}

const money = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const num = (n: number | null | undefined, digits = 0) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

/**
 * 100 = el promedio de los lotes de ESE cultivo. Nunca se compara maíz contra soja.
 *
 * Sin índice hay dos motivos distintos y NO se muestran igual: un lote todavía en pie no tiene
 * rinde que comparar, y uno que es el único de su cultivo no tiene contra qué. Decirle «único» al
 * primero sería una etiqueta falsa sobre una fila que además ya trae su propia explicación.
 */
function IndexBadge({ value, hasYield }: { value: number | null; hasYield: boolean }) {
  if (!hasYield) return <span className="text-ink-3">—</span>;
  if (value == null) return <span className="text-caption text-ink-3">único</span>;
  const tone = value > 103 ? 'text-success' : value < 97 ? 'text-danger' : 'text-ink-2';
  return <span className={`tnum text-body font-semibold ${tone}`}>{value}</span>;
}

/**
 * Rinde y costo por hectárea (Fase 4).
 *
 * El índice compara cada lote contra los del MISMO cultivo: maíz y soja rinden en órdenes distintos
 * y una escala común no significaría nada. Con un solo lote del cultivo no hay índice — un 100 se
 * leería como «promedio» cuando en realidad es «no hay con qué comparar».
 *
 * La columna de margen queda vacía a propósito cuando el grano todavía no se vendió: el precio sale
 * de ventas reales, y un margen sobre un precio supuesto se ve igual de convincente que uno real.
 */
export function CropYields({ data }: { data: CropYieldReport }) {
  if (!data.crops.length) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <CardTitle>Rinde y costo por hectárea</CardTitle>
          <span className="text-caption text-ink-3">
            {data.from} → {data.to}
          </span>
        </div>
        <p className="text-label text-ink-3">
          El rinde se calcula como cosecha dividida por superficie. El margen aparece solo cuando ese grano se vendió: el precio sale de la venta real, no de
          una estimación.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-subtle pt-2 text-caption text-ink-3">
          {data.by_type.map((t) => (
            <span key={t.cropType}>
              <span className="font-medium capitalize text-ink-2">{t.cropType}</span> · {t.crops} lote{t.crops === 1 ? '' : 's'} · {num(t.areaHa)} ha · promedio{' '}
              <span className="tnum">{num(t.meanYieldPerHa)}</span>/ha
              {t.totalMargin != null && (
                <>
                  {' '}
                  · margen <span className="tnum">{money(t.totalMargin)}</span>
                </>
              )}
            </span>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Lote por lote</CardTitle>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[50rem] text-body">
            <thead>
              <tr className="border-b border-subtle text-left text-caption text-ink-3">
                <th className="py-2 font-medium">Lote</th>
                <th className="py-2 text-right font-medium">Sup.</th>
                <th className="py-2 text-right font-medium">Rinde/ha</th>
                <th className="py-2 text-right font-medium">Índice</th>
                <th className="py-2 text-right font-medium">Costo/ha</th>
                <th className="py-2 text-right font-medium">Costo/unidad</th>
                <th className="py-2 text-right font-medium">Margen</th>
              </tr>
            </thead>
            <tbody>
              {data.crops.map((c) => (
                <tr key={c.cropId} className="border-b border-subtle align-top last:border-0">
                  <td className="py-2">
                    <div className="font-medium">{c.paddock_name ?? '—'}</div>
                    <div className="text-caption text-ink-3">
                      {/* Solo el cultivo se capitaliza: `capitalize` sobre la línea entera convertía
                          «en pie» en «En Pie». */}
                      <span className="capitalize">{c.cropType}</span>
                      {c.variety ? ` · ${c.variety}` : ''}
                      {c.status === 'growing' ? ' · en pie' : ''}
                    </div>
                    {c.caveat && <p className="mt-0.5 max-w-md text-caption text-ink-3">{c.caveat}</p>}
                  </td>
                  <td className="tnum py-2 text-right">{num(c.areaHa, 1)} ha</td>
                  <td className="tnum py-2 text-right font-semibold">
                    {num(c.yieldPerHa)}
                    {c.yieldPerHa != null && c.yield_unit && <span className="ml-0.5 text-caption font-normal text-ink-3">{c.yield_unit}</span>}
                  </td>
                  <td className="py-2 text-right">
                    <IndexBadge value={c.yieldIndex} hasYield={c.yieldPerHa != null} />
                  </td>
                  <td className="tnum py-2 text-right">{money(c.costPerHa)}</td>
                  <td className="tnum py-2 text-right">{c.costPerUnit == null ? '—' : c.costPerUnit.toLocaleString('es-AR', { maximumFractionDigits: 3 })}</td>
                  <td className="tnum py-2 text-right">
                    <span className={c.margin != null && c.margin < 0 ? 'font-medium text-danger' : ''}>{money(c.margin)}</span>
                    {c.price_used != null ? (
                      <div className="text-caption font-normal text-ink-3">a {c.price_used.toLocaleString('es-AR', { maximumFractionDigits: 3 })}/u</div>
                    ) : (
                      <div className="text-caption font-normal text-ink-3">sin vender</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
