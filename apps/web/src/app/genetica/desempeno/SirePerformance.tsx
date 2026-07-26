'use client';

import Link from 'next/link';
import { Card, CardTitle, EmptyState } from '@/components/ui';

interface SireCost {
  sireId: string;
  sire_name: string;
  n: number;
  meanKg: number;
  index: number;
  confidence: 'baja' | 'media' | 'alta';
  services: number;
  conceptions: number;
  conception_rate_pct: number | null;
  straw_cost: number | null;
  strawsPerPregnancy: number | null;
  costPerCalf: number | null;
  costPerWeanedKg: number | null;
}

interface CostReport {
  year: number | null;
  available_years: number[];
  group_size: number;
  incomplete: number;
  discarded: number;
  sires: SireCost[];
}

interface CarcassSire {
  sireId: string;
  sire_name: string;
  n: number;
  avg_carcass_kg: number | null;
  avg_dressing_pct: number | null;
  without_live_weight: number;
}

const fmt = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

/** El índice es el número que se lee primero: 100 es el promedio del grupo. */
function IndexBadge({ value }: { value: number }) {
  const tone = value > 103 ? 'text-success' : value < 97 ? 'text-danger' : 'text-ink-2';
  return <span className={`tnum text-body font-semibold ${tone}`}>{value}</span>;
}

/** Sin esto, un toro con dos hijos se lee igual que uno con cuarenta. */
function Confidence({ level }: { level: 'baja' | 'media' | 'alta' }) {
  return <span className="text-caption text-ink-3">conf. {level}</span>;
}

export function SirePerformance({ cost, carcass }: { cost: CostReport; carcass: { total: number; sires: CarcassSire[] } | null }) {
  const gancho = new Map((carcass?.sires ?? []).map((c) => [c.sireId, c]));

  if (cost.sires.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay con qué comparar toros"
        body="Hace falta que los terneros tengan padre cargado y peso al destete registrado. Con eso el sistema arma el grupo contemporáneo y calcula el índice."
      />
    );
  }

  // Ordenado por costo por kilo, que es la pregunta económica. El que no se puede calcular va al
  // final: no es «barato», es que falta el precio de la pajuela o la tasa de concepción.
  const porCosto = [...cost.sires].sort((a, b) => (a.costPerWeanedKg ?? Infinity) - (b.costPerWeanedKg ?? Infinity));
  const mejorIndice = [...cost.sires].sort((a, b) => b.index - a.index)[0];
  const mejorCosto = porCosto[0];
  const tension = mejorCosto.costPerWeanedKg != null && mejorIndice.sireId !== mejorCosto.sireId;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-body font-medium">Parición</span>
          <div className="flex flex-wrap gap-1">
            {cost.available_years.map((y) => (
              <Link
                key={y}
                href={`/genetica/desempeno?year=${y}`}
                className={`rounded px-2 py-1 text-body ${y === cost.year ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-2'}`}
              >
                {y}
              </Link>
            ))}
          </div>
          <span className="text-label text-ink-3">
            Se compara dentro del año de nacimiento: los terneros de una misma parición compartieron clima, pasto y manejo. Comparar contra otro año le
            atribuiría a la genética lo que fue la lluvia.
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-subtle pt-2 text-caption text-ink-3">
          <span>
            <span className="tnum text-ink-2">{cost.group_size}</span> terneros en el grupo
          </span>
          {cost.incomplete > 0 && (
            <span>
              <span className="tnum text-ink-2">{cost.incomplete}</span> sin peso de nacimiento o edad de madre — cuentan, pero son menos comparables
            </span>
          )}
          {cost.discarded > 0 && (
            <span>
              <span className="tnum text-ink-2">{cost.discarded}</span> descartados por datos imposibles
            </span>
          )}
        </div>
      </Card>

      {tension && (
        <Card>
          <p className="text-body">
            <span className="font-medium">{mejorIndice.sire_name}</span> es el mejor al destete (índice {mejorIndice.index}), pero el kilo más barato lo pone{' '}
            <span className="font-medium">{mejorCosto.sire_name}</span>, a <span className="tnum">{fmt(mejorCosto.costPerWeanedKg, 2)}</span> por kilo destetado
            contra <span className="tnum">{fmt(mejorIndice.costPerWeanedKg, 2)}</span>.
          </p>
          <p className="mt-1 text-label text-ink-3">
            No es una contradicción: rendir más y convenir más son preguntas distintas. La decisión es del productor, pero con los dos números a la vista.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>Toros del grupo</CardTitle>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[52rem] text-body">
            <thead>
              <tr className="border-b border-subtle text-left text-caption text-ink-3">
                <th className="py-2 font-medium">Toro</th>
                <th className="py-2 text-right font-medium">Hijos</th>
                <th className="py-2 text-right font-medium">Destete aj.</th>
                <th className="py-2 text-right font-medium">Índice</th>
                <th className="py-2 text-right font-medium">Concepción</th>
                <th className="py-2 text-right font-medium">Dosis/preñez</th>
                <th className="py-2 text-right font-medium">Pajuela</th>
                <th className="py-2 text-right font-medium">Costo/ternero</th>
                <th className="py-2 text-right font-medium">Costo/kg destetado</th>
                <th className="py-2 text-right font-medium">Rinde res</th>
              </tr>
            </thead>
            <tbody>
              {porCosto.map((s) => {
                const g = gancho.get(s.sireId);
                return (
                  <tr key={s.sireId} className="border-b border-subtle last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{s.sire_name}</div>
                      <Confidence level={s.confidence} />
                    </td>
                    <td className="tnum py-2 text-right">{s.n}</td>
                    <td className="tnum py-2 text-right">{fmt(s.meanKg)} kg</td>
                    <td className="py-2 text-right">
                      <IndexBadge value={s.index} />
                    </td>
                    <td className="tnum py-2 text-right">
                      {s.conception_rate_pct == null ? '—' : `${fmt(s.conception_rate_pct)}%`}
                      <div className="text-caption font-normal text-ink-3">
                        {s.conceptions}/{s.services}
                      </div>
                    </td>
                    <td className="tnum py-2 text-right">{fmt(s.strawsPerPregnancy, 2)}</td>
                    <td className="tnum py-2 text-right">{fmt(s.straw_cost, 2)}</td>
                    <td className="tnum py-2 text-right">{fmt(s.costPerCalf, 2)}</td>
                    <td className="tnum py-2 text-right font-semibold">{fmt(s.costPerWeanedKg, 2)}</td>
                    <td className="tnum py-2 text-right">
                      {g?.avg_dressing_pct == null ? '—' : `${fmt(g.avg_dressing_pct)}%`}
                      {g != null && g.n > 0 && <div className="text-caption font-normal text-ink-3">{g.n} res</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 border-t border-subtle pt-2 text-label text-ink-3">
          Una pajuela no es un ternero: con 50% de concepción hacen falta dos dosis por preñez, así que el costo real por ternero es el doble del precio. Por eso
          el ranking por costo puede no seguir al ranking por precio. Un guion significa que falta un dato — el precio de la partida o servicios cargados —, no
          que sea gratis.
        </p>
      </Card>
    </div>
  );
}
