import { computeUnitCost } from '../costing/unit-cost';

/**
 * Métricas de engorde a corral (C2 · feedlot) — DERIVADAS, regla única. Un corral es un lote con
 * `purpose='fattening'`. Sobre los datos ya existentes (consumo de alimento de `feed_deliveries`,
 * peso/GDP de `v_weighings`) se derivan los indicadores clave del engorde. Nada se persiste: se
 * calcula al leer, reusando el GDP como fuente única (ADR-0007).
 *
 * - `conversion`: kg de alimento por kg ganado (kgFeed / kgGained). null si no hubo ganancia.
 * - `costPerKgGained`: costo del kilo ganado. Delega en `computeUnitCost` (regla única de costo
 *   unitario, G2): la división y sus guardas viven en un solo lugar. null si no hubo ganancia.
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

  const conversion = gained && Number.isFinite(feedKg) ? round2(feedKg / kgGained) : null;
  const { unitCost: costPerKgGained } = computeUnitCost({ totalCost: feedCost, output: kgGained });

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
