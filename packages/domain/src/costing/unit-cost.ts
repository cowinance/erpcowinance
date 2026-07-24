/**
 * Costo unitario por actividad (G2 · E2) — regla única, DERIVADA.
 *
 * Un costo total solo se vuelve accionable cuando se divide por lo que se produjo: no importa haber
 * gastado $2.000.000 en el corral, importa que el kilo ganado salió $1.850. Esta es la única función
 * del sistema que hace esa división, con sus guardas:
 *
 *  - producción ≤ 0 (o no numérica) ⇒ `unitCost: null`. NO es cero: un lote que perdió peso o un
 *    tambo sin ordeñes no tiene "costo por unidad barato", simplemente no tiene el dato. Devolver 0
 *    haría que ordene primero como si fuera el más eficiente.
 *  - `areaHa` opcional habilita el costo por hectárea, la unidad con la que se compara agricultura.
 *
 * La usan tanto el motor de costos por actividad como las métricas de engorde (`computeFeedlotMetrics`
 * la delega para su costo del kilo ganado), así el redondeo y las guardas viven en un solo lugar.
 */
export interface UnitCostInput {
  /** Costo acumulado del período, en la moneda de la organización. */
  totalCost: number;
  /** Lo producido en el mismo período: kg ganados, litros, kg cosechados… */
  output: number;
  /** Superficie afectada, si la actividad se mide por hectárea (agricultura). */
  areaHa?: number | null;
}

export interface UnitCostResult {
  /** Costo por unidad producida. `null` si no hubo producción medible. */
  unitCost: number | null;
  /** Costo por hectárea. `null` si no se informó superficie. */
  costPerHa: number | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function computeUnitCost(input: UnitCostInput): UnitCostResult {
  const cost = Number(input.totalCost);
  if (!Number.isFinite(cost)) return { unitCost: null, costPerHa: null };

  const output = positive(input.output);
  const areaHa = positive(input.areaHa);

  return {
    unitCost: output === null ? null : round2(cost / output),
    costPerHa: areaHa === null ? null : round2(cost / areaHa),
  };
}
