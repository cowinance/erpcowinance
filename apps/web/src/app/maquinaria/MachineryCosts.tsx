'use client';

import { Card, CardTitle } from '@/components/ui';

interface MachineCost {
  meter: 'hours' | 'km' | null;
  usage: number | null;
  fuelCost: number;
  maintenanceCost: number;
  totalCost: number;
  costPerUnit: number | null;
  fuelPerUnit: number | null;
  correctiveSharePct: number | null;
  caveat: string | null;
}
interface Machine {
  id: string;
  name: string;
  type: string | null;
  status: string;
  cost: MachineCost;
}
export interface MachineryCostReport {
  from: string;
  to: string;
  by_hours: Machine[];
  by_km: Machine[];
  unmeasured: Machine[];
  totals: { fuel_cost: number; maintenance_cost: number; total_cost: number };
}

const money = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : n.toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const num = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

/**
 * Lo que cuesta usar cada máquina (Fase 4).
 *
 * Horas y kilómetros van en tablas SEPARADAS, no en columnas de la misma. Un ranking que mezcle un
 * tractor medido en horas con una camioneta medida en kilómetros tiene apariencia de orden y
 * ningún sentido, y el orden es justamente lo que alguien va a mirar para decidir.
 *
 * La proporción de correctivo va al lado del costo porque es la señal que el costo total esconde:
 * dos máquinas que cuestan lo mismo por hora no son la misma máquina si una gasta en service y la
 * otra en roturas.
 */
export function MachineryCosts({ data }: { data: MachineryCostReport }) {
  const hayAlgo = data.by_hours.length + data.by_km.length + data.unmeasured.length > 0;
  if (!hayAlgo) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <CardTitle>Lo que cuesta usar cada máquina</CardTitle>
          <span className="text-caption text-ink-3">
            {data.from} → {data.to}
          </span>
        </div>
        <p className="text-label text-ink-3">
          Combustible más mantenimiento, repartidos sobre las horas (o los kilómetros) que la máquina trabajó en el período. El uso sale del horómetro anotado
          en cada carga, no del valor de hoy.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-subtle pt-2 text-caption text-ink-3">
          <span>
            Combustible <span className="tnum text-ink-2">{money(data.totals.fuel_cost, 0)}</span>
          </span>
          <span>
            Mantenimiento <span className="tnum text-ink-2">{money(data.totals.maintenance_cost, 0)}</span>
          </span>
          <span>
            Total <span className="tnum font-medium text-ink-1">{money(data.totals.total_cost, 0)}</span>
          </span>
        </div>
      </Card>

      {data.by_hours.length > 0 && <CostTable title="Medidas en horas" unit="h" machines={data.by_hours} />}
      {data.by_km.length > 0 && <CostTable title="Medidas en kilómetros" unit="km" machines={data.by_km} />}

      {data.unmeasured.length > 0 && (
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{data.unmeasured.length}</span>}>Con gasto pero sin medidor anotado</CardTitle>
          <p className="mb-2 text-label text-ink-3">
            No son las máquinas más baratas: son las que no se pudieron medir. Anotar el horómetro al cargar combustible es lo único que falta para que entren
            en la comparación.
          </p>
          <ul className="divide-y divide-subtle">
            {data.unmeasured.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-1.5">
                <span className="text-body">{m.name}</span>
                <span className="tnum text-label text-ink-3">{money(m.cost.totalCost, 0)} gastados</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function CostTable({ title, unit, machines }: { title: string; unit: string; machines: Machine[] }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[42rem] text-body">
          <thead>
            <tr className="border-b border-subtle text-left text-caption text-ink-3">
              <th className="py-2 font-medium">Máquina</th>
              <th className="py-2 text-right font-medium">Uso</th>
              <th className="py-2 text-right font-medium">Combustible</th>
              <th className="py-2 text-right font-medium">Mantenimiento</th>
              <th className="py-2 text-right font-medium">Costo/{unit}</th>
              <th className="py-2 text-right font-medium">Consumo</th>
              <th className="py-2 text-right font-medium">Por rotura</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.id} className="border-b border-subtle align-top last:border-0">
                <td className="py-2">
                  <div className="font-medium">{m.name}</div>
                  {m.cost.caveat && <p className="mt-0.5 max-w-md text-caption text-warning">{m.cost.caveat}</p>}
                </td>
                <td className="tnum py-2 text-right">
                  {num(m.cost.usage, 0)} {unit}
                </td>
                <td className="tnum py-2 text-right">{money(m.cost.fuelCost, 0)}</td>
                <td className="tnum py-2 text-right">{money(m.cost.maintenanceCost, 0)}</td>
                <td className="tnum py-2 text-right font-semibold">{money(m.cost.costPerUnit)}</td>
                <td className="tnum py-2 text-right">{num(m.cost.fuelPerUnit, 2)} l/{unit}</td>
                <td
                  className={`tnum py-2 text-right ${
                    m.cost.correctiveSharePct != null && m.cost.correctiveSharePct > 50 ? 'font-medium text-warning' : 'text-ink-3'
                  }`}
                >
                  {m.cost.correctiveSharePct == null ? '—' : `${num(m.cost.correctiveSharePct, 0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
