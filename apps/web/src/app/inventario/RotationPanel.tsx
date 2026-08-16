'use client';

import { Card, CardTitle, KpiCard } from '@/components/ui';

interface RotationItem {
  id: string;
  name: string;
  unit: string;
  reorder_point: number | null;
  stock: number;
  consumed: number;
  dailyUse: number | null;
  coverageDays: number | null;
  turnsPerYear: number | null;
  suggestedReorderPoint: number | null;
  stockValue: number | null;
  status: 'sin_stock' | 'critico' | 'normal' | 'dormido';
  caveat: string | null;
}
export interface RotationReport {
  from: string;
  to: string;
  period_days: number;
  lead_time_days: number;
  items: RotationItem[];
  totals: { stock_value: number; idle_value: number; idle_items: number; critical_items: number; items_without_cost: number };
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

const ESTADO: Record<string, { label: string; tone: string }> = {
  sin_stock: { label: 'Sin stock', tone: 'border-danger/30 bg-danger/10 text-danger' },
  critico: { label: 'No llega', tone: 'border-danger/30 bg-danger/10 text-danger' },
  dormido: { label: 'Dormido', tone: 'border-warning/30 bg-warning/10 text-warning' },
  normal: { label: 'Alcanza', tone: 'border-subtle text-ink-3' },
};

/**
 * Rotación del inventario (Fase 4).
 *
 * La columna que decide una compra es **cobertura**, no saldo: 600 litros pueden ser mucho o nada
 * según cuánto se use. Y el «mínimo sugerido» está al lado a propósito — la alerta de stock bajo
 * depende de un mínimo cargado a mano, y en el ítem donde nadie lo cargó no suena nunca.
 *
 * «Dormido» no es lo mismo que «alcanza», aunque los dos tengan saldo: uno es stock y el otro es
 * plata quieta. A ojo se ven igual, y por eso el estado va en su propia columna.
 */
export function RotationPanel({ data }: { data: RotationReport }) {
  if (!data.items.length) return null;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard label="Valor del stock" value={money(t.stock_value)} hint={`${data.items.length} ítems activos`} />
        <KpiCard
          label="Plata quieta"
          value={money(t.idle_value)}
          hint={t.idle_items === 0 ? 'Nada dormido' : `${t.idle_items} ítem${t.idle_items === 1 ? '' : 's'} sin consumo`}
        />
        <KpiCard label="No llegan a la reposición" value={String(t.critical_items)} hint={`Reposición: ${data.lead_time_days} días`} />
        <KpiCard label="Sin costo cargado" value={String(t.items_without_cost)} hint="No entran en los totales" />
      </div>

      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <CardTitle>Para cuántos días alcanza</CardTitle>
          <span className="text-caption text-ink-3">
            consumo de {data.from} a {data.to}
          </span>
        </div>
        <p className="text-label text-ink-3">
          El consumo cuenta lo que <em>salió</em>: no las compras ni las transferencias entre depósitos, que no gastan nada. El mínimo sugerido es lo que se
          consume mientras llega una reposición.
        </p>
        <div className="-mx-4 mt-3 overflow-x-auto px-4">
          {/* Ver la nota de `StockPanel`: las dos tablas de esta pantalla necesitan nombre propio. */}
          <table className="w-full min-w-[46rem] text-body" aria-label="Rotación de inventario">
            <thead>
              <tr className="border-b border-subtle text-left text-caption text-ink-3">
                <th className="py-2 font-medium">Ítem</th>
                <th className="py-2 text-right font-medium">Saldo</th>
                <th className="py-2 text-right font-medium">Consumo/día</th>
                <th className="py-2 text-right font-medium">Cobertura</th>
                <th className="py-2 text-right font-medium">Mínimo sugerido</th>
                <th className="py-2 text-right font-medium">Valor</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-subtle align-top last:border-0">
                  <td className="py-2">
                    <div className="font-medium">{i.name}</div>
                    {i.caveat && <p className="mt-0.5 max-w-md text-caption text-ink-3">{i.caveat}</p>}
                  </td>
                  <td className="tnum py-2 text-right">
                    {num(i.stock)} {i.unit}
                  </td>
                  <td className="tnum py-2 text-right">{num(i.dailyUse, 2)}</td>
                  <td className={`tnum py-2 text-right font-semibold ${i.status === 'critico' || i.status === 'sin_stock' ? 'text-danger' : ''}`}>
                    {i.coverageDays == null ? '—' : `${i.coverageDays} d`}
                  </td>
                  <td className="tnum py-2 text-right">
                    {num(i.suggestedReorderPoint)}
                    {i.reorder_point != null && <div className="text-caption text-ink-3">cargado: {num(i.reorder_point)}</div>}
                  </td>
                  <td className="tnum py-2 text-right">{money(i.stockValue)}</td>
                  <td className="py-2">
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium ${ESTADO[i.status].tone}`}>
                      {ESTADO[i.status].label}
                    </span>
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
