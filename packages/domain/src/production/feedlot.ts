import { costPerUnit } from '../costing/unit-cost';

/**
 * Métricas de engorde a corral (C2 · feedlot) — DERIVADAS, regla única. Un corral es un lote con
 * `purpose='fattening'`. Sobre los datos ya existentes (consumo de alimento de `feed_deliveries`,
 * peso/GDP de `v_weighings`) se derivan los indicadores clave del engorde. Nada se persiste: se
 * calcula al leer, reusando el GDP como fuente única (ADR-0007).
 *
 * - `conversion`: kg de alimento por kg ganado (kgFeed / kgGained). null si no hubo ganancia — y
 *   también si NO SE CARGÓ ALIMENTO: un corral sin entregas registradas daba «conversión 0», que se
 *   lee como conversión perfecta y ordena primero justo al que no tiene los datos. Un animal vivo no
 *   ganó 1.490 kg comiendo cero; lo que falta es el dato, no el alimento.
 * - `costPerKgGained`: costo del kilo ganado. Delega en `costPerUnit` (regla única, G2): la división
 *   y sus guardas —incluida la de costo sin atribuir— viven en un solo lugar. null si no hubo
 *   ganancia o si no hay costo cargado.
 * - `daysToFinish`: días a terminación = (pesoObjetivo − pesoActual) / GDP. null si falta objetivo,
 *   el GDP no es positivo, o ya se alcanzó el objetivo.
 */
export interface FeedlotInput {
  feedKg: number;
  feedCost: number;
  kgGained: number;
  avgWeightKg: number | null;
  avgAdg: number | null;
  targetWeightKg?: number | null;
}

export interface FeedlotMetrics {
  conversion: number | null;
  costPerKgGained: number | null;
  daysToFinish: number | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => Number(v);

export function computeFeedlotMetrics(input: FeedlotInput): FeedlotMetrics {
  const feedKg = num(input.feedKg);
  const feedCost = num(input.feedCost);
  const kgGained = num(input.kgGained);
  const gained = Number.isFinite(kgGained) && kgGained > 0;

  // `feedKg > 0` y no solo `isFinite`: sin alimento cargado la conversión es desconocida, no cero.
  const conversion = gained && Number.isFinite(feedKg) && feedKg > 0 ? round2(feedKg / kgGained) : null;
  const { unitCost: costPerKgGained } = costPerUnit({ totalCost: feedCost, output: kgGained });

  let daysToFinish: number | null = null;
  const target = input.targetWeightKg;
  const avgWeight = input.avgWeightKg;
  const avgAdg = input.avgAdg;
  if (target != null && avgWeight != null && avgAdg != null) {
    const remaining = num(target) - num(avgWeight);
    const adg = num(avgAdg);
    if (Number.isFinite(remaining) && remaining > 0 && Number.isFinite(adg) && adg > 0) {
      daysToFinish = Math.ceil(remaining / adg);
    }
  }
  return { conversion, costPerKgGained, daysToFinish };
}
