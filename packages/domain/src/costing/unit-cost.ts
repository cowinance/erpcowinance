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

/**
 * ¿Este costo total es un COSTO, o es que no se cargó ninguno?
 *
 * Un total en cero con producción no dice «producir salió gratis», dice que nadie clasificó el
 * gasto todavía. La diferencia importa porque el número se usa para comparar: un corral con «$0 el
 * kilo» ordena primero, como el más eficiente de la finca, y es exactamente el que no tiene los
 * datos cargados.
 *
 * Es el mismo razonamiento que la guarda de producción de acá abajo, aplicado al otro lado de la
 * división. El motor de costos ya lo hacía por su cuenta —ocultaba el unitario cuando `cost <= 0` y
 * explicaba por qué— pero las métricas de engorde no, así que el MISMO número salía en cero en el
 * lote y oculto en costos. Ahora la regla es una sola.
 *
 * Ojo con lo que NO entra acá: un MARGEN en cero sí es un dato —quedar hecho— y uno negativo
 * también. Por eso `computeUnitCost` sigue siendo la división neutra y esto es una capa aparte:
 * ocultar un margen cero escondería justo la actividad que no deja nada.
 */
export function costPerUnit(input: UnitCostInput): UnitCostResult {
  const cost = Number(input.totalCost);
  const sinCostoAtribuido = !Number.isFinite(cost) || cost <= 0;
  if (sinCostoAtribuido) return { unitCost: null, costPerHa: null };
  return computeUnitCost(input);
}

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
