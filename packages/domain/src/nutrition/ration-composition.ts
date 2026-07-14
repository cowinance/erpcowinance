/**
 * Composición de una ración (N-1): sus ingredientes deben sumar 100% (regla única de una fórmula bien
 * formada). El costo por kg es DERIVADO: Σ (pct/100 × costo estándar del ítem) — costo INDICATIVO de
 * planificación; el costo real de una entrega usa el avg_cost del stock consumido (N-2).
 */
export interface RationIngredientInput {
  inventory_item_id: string;
  pct: number;
  /** Costo estándar del ítem (para el costo indicativo); ausente/null = aporta 0. */
  standard_cost?: number | null;
}

export class InvalidRationCompositionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidRationCompositionError';
  }
}

const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Valida que los ingredientes sumen 100% (±0.01) y que cada pct sea > 0. Lanza si no. */
export function validateRationPct(ingredients: RationIngredientInput[]): void {
  if (!Array.isArray(ingredients) || ingredients.length === 0) throw new InvalidRationCompositionError('La ración necesita al menos un ingrediente');
  let total = 0;
  for (const ing of ingredients) {
    const pct = Number(ing.pct);
    if (!Number.isFinite(pct) || pct <= 0) throw new InvalidRationCompositionError('Cada ingrediente debe tener un porcentaje positivo');
    total = round3(total + pct);
  }
  if (Math.abs(total - 100) > 0.01) throw new InvalidRationCompositionError(`Los porcentajes deben sumar 100% (suman ${total})`);
}

/** Costo indicativo por kg: Σ (pct/100 × standard_cost). Ítem sin costo aporta 0. */
export function rationCostPerKg(ingredients: RationIngredientInput[]): number {
  const cost = ingredients.reduce((s, ing) => {
    const c = ing.standard_cost == null ? 0 : Number(ing.standard_cost);
    return s + (Number(ing.pct) / 100) * (Number.isFinite(c) ? c : 0);
  }, 0);
  return round4(cost);
}
