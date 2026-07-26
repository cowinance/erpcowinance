/**
 * Costo de la genética por kilo destetado (Fase 2.5).
 *
 * Es la pregunta que cierra el módulo. La evaluación por desempeño contesta **cuál rinde más**; ésta
 * contesta **cuál conviene**, que no es lo mismo: un toro 8% mejor al destete que cuesta el triple
 * por dosis puede ser el peor negocio de la finca.
 *
 * La cuenta tiene dos pasos y el primero es el que la gente olvida:
 *
 *   1. Una pajuela NO es un ternero. Con 60% de concepción hacen falta ~1,7 dosis por preñez, así
 *      que el costo real por ternero es el precio dividido por la tasa de concepción.
 *   2. Recién ahí se divide por los kilos que ese ternero destetó.
 *
 *   costo por kg = (precio_pajuela / tasa_concepción) / kg_destetados
 *
 * Comparar precios de pajuela sin el paso 1 favorece sistemáticamente al semen barato de baja
 * fertilidad, que es el error más caro que se puede cometer con esta información.
 *
 * Puro, sin IO.
 */

export interface GeneticCostInput {
  /** Precio de una dosis, en la moneda de la finca. */
  strawCost: number;
  /** Tasa de concepción del toro, en porcentaje (0–100). */
  conceptionRatePct: number | null | undefined;
  /** Peso promedio al destete de su progenie, ajustado. */
  avgWeaningKg: number | null | undefined;
}

export interface GeneticCost {
  /** Dosis necesarias por preñez lograda. */
  strawsPerPregnancy: number | null;
  /** Costo de semen por ternero logrado. */
  costPerCalf: number | null;
  /** Lo que se quiere comparar entre toros. */
  costPerWeanedKg: number | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Costo de semen por kilo destetado.
 *
 * Devuelve `null` en los eslabones que no se pueden calcular en vez de un cero o un número
 * aproximado: sin tasa de concepción no se sabe cuántas dosis hacen falta, y sin peso al destete no
 * hay kilos entre los cuales repartir el costo. Un cero se leería como «gratis», que es la lectura
 * más peligrosa posible acá.
 */
export function computeGeneticCost(input: GeneticCostInput): GeneticCost {
  const precio = Number(input.strawCost);
  if (!Number.isFinite(precio) || precio < 0) return { strawsPerPregnancy: null, costPerCalf: null, costPerWeanedKg: null };

  const tasa = Number(input.conceptionRatePct);
  // Tasa 0 no es «infinitas dosis»: es que ese toro no preñó nada, y dividir daría infinito. Se
  // informa como incalculable, que es lo que realmente pasa.
  const tasaValida = Number.isFinite(tasa) && tasa > 0;
  const dosis = tasaValida ? round2(100 / tasa) : null;
  const porTernero = dosis == null ? null : round2(precio * dosis);

  const kg = Number(input.avgWeaningKg);
  const kgValido = Number.isFinite(kg) && kg > 0;
  const porKg = porTernero == null || !kgValido ? null : round2(porTernero / kg);

  return { strawsPerPregnancy: dosis, costPerCalf: porTernero, costPerWeanedKg: porKg };
}
