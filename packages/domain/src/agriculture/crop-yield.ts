/**
 * Rinde y costo por hectárea de cada cultivo, comparados contra los suyos (Fase 4).
 *
 * Agricultura registraba labores y cosechas y no contestaba ninguna de las tres preguntas que se
 * hacen al cerrar una campaña: **¿cuánto rindió?**, **¿cuánto costó la hectárea?** y **¿este lote
 * anduvo mejor o peor que los otros del mismo cultivo?**
 *
 * Tres decisiones sostienen que los números sirvan:
 *
 * 1. **El rinde se DERIVA de cosecha ÷ superficie.** `harvests.yield_per_ha` existe como columna
 *    guardada y no se usa: es un dato que alguien escribió y que puede no coincidir con la cantidad
 *    y la superficie que están al lado. Dos verdades sobre el mismo número es peor que una sola
 *    incómoda — el mismo criterio con el que el rendimiento de la res se deriva del peso vivo y no
 *    de la columna.
 *
 * 2. **La comparación es contra el MISMO cultivo.** Un índice que ponga maíz y soja en la misma
 *    escala no significa nada: rinden en órdenes distintos. El índice 100 es el promedio de los
 *    lotes de ese cultivo, igual que en la evaluación de toros — cuando dos pantallas usan la misma
 *    palabra tiene que querer decir lo mismo.
 *
 * 3. **Sin precio no hay margen, y no se inventa uno.** El costo por hectárea se calcula siempre;
 *    el margen solo cuando hay un precio real con qué valorizar. Un margen sobre un precio supuesto
 *    se ve igual de convincente que uno real.
 *
 * Puro, sin IO.
 */

export interface CropInput {
  cropId: string;
  cropType: string;
  /** Superficie sembrada. Sin esto no hay nada por hectárea. */
  areaHa: number | null;
  /** Cantidad cosechada, sumando todas las cosechas del lote. */
  harvested: number | null;
  /** Suma de las labores: siembra, fertilización, pulverización, cosecha. */
  cost: number | null;
  /**
   * Precio por unidad cosechada con el que valorizar. `null` = no se conoce, y entonces no hay
   * margen. Nunca se supone uno.
   */
  price?: number | null;
}

export interface CropYield {
  cropId: string;
  cropType: string;
  areaHa: number | null;
  harvested: number | null;
  cost: number | null;
  /** Cosecha ÷ superficie. Lo comparable entre lotes de distinto tamaño. */
  yieldPerHa: number | null;
  costPerHa: number | null;
  /** Lo que costó producir cada unidad: el número que se compara contra el precio. */
  costPerUnit: number | null;
  /** 100 = el promedio de los lotes de ESTE cultivo. `null` si es el único. */
  yieldIndex: number | null;
  revenue: number | null;
  margin: number | null;
  marginPerHa: number | null;
  caveat: string | null;
}

export interface CropYieldReport {
  crops: CropYield[];
  /** Promedio de rinde por cultivo, con cuántos lotes lo sostienen. */
  byType: { cropType: string; crops: number; areaHa: number; meanYieldPerHa: number | null; totalCost: number; totalMargin: number | null }[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
const positivo = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function computeCropYields(input: CropInput[]): CropYieldReport {
  const base = input.map((c) => {
    const areaHa = positivo(c.areaHa);
    const harvested = c.harvested == null ? null : Math.max(0, Number(c.harvested) || 0);
    const costo = c.cost == null ? null : Math.max(0, Number(c.cost) || 0);
    const yieldPerHa = harvested != null && harvested > 0 && areaHa != null ? round3(harvested / areaHa) : null;
    const costPerHa = costo != null && areaHa != null ? round2(costo / areaHa) : null;
    const costPerUnit = costo != null && harvested != null && harvested > 0 ? round3(costo / harvested) : null;

    // Sin precio no hay margen. Un cero se leería como «no dejó nada», que es una conclusión, no
    // una falta de dato.
    const precio = c.price == null ? null : positivo(c.price);
    const revenue = precio != null && harvested != null ? round2(harvested * precio) : null;
    const margin = revenue != null && costo != null ? round2(revenue - costo) : null;
    const marginPerHa = margin != null && areaHa != null ? round2(margin / areaHa) : null;

    return { cropId: c.cropId, cropType: c.cropType, areaHa, harvested, cost: costo, yieldPerHa, costPerHa, costPerUnit, revenue, margin, marginPerHa };
  });

  // Promedio PONDERADO POR SUPERFICIE dentro de cada cultivo: promediar los rindes de un lote de
  // 2 ha y uno de 80 como si pesaran igual daría un promedio que no existió en ninguna hectárea.
  const promedios = new Map<string, number | null>();
  for (const tipo of new Set(base.map((c) => c.cropType))) {
    const conRinde = base.filter((c) => c.cropType === tipo && c.yieldPerHa != null && c.areaHa != null);
    const ha = conRinde.reduce((s, c) => s + c.areaHa!, 0);
    promedios.set(tipo, ha > 0 ? round3(conRinde.reduce((s, c) => s + c.yieldPerHa! * c.areaHa!, 0) / ha) : null);
  }

  const crops = base.map<CropYield>((c) => {
    const prom = promedios.get(c.cropType) ?? null;
    const hermanos = base.filter((x) => x.cropType === c.cropType && x.yieldPerHa != null).length;
    // Con un solo lote no hay contra qué comparar, y un índice 100 se leería como «promedio».
    const yieldIndex = c.yieldPerHa != null && prom != null && prom > 0 && hermanos > 1 ? Math.round((c.yieldPerHa / prom) * 100) : null;
    return { ...c, yieldIndex, caveat: avisoDe(c, yieldIndex) };
  });

  const byType = [...new Set(crops.map((c) => c.cropType))]
    .map((cropType) => {
      const delTipo = crops.filter((c) => c.cropType === cropType);
      const conMargen = delTipo.filter((c) => c.margin != null);
      return {
        cropType,
        crops: delTipo.length,
        areaHa: round2(delTipo.reduce((s, c) => s + (c.areaHa ?? 0), 0)),
        meanYieldPerHa: promedios.get(cropType) ?? null,
        totalCost: round2(delTipo.reduce((s, c) => s + (c.cost ?? 0), 0)),
        totalMargin: conMargen.length > 0 ? round2(conMargen.reduce((s, c) => s + c.margin!, 0)) : null,
      };
    })
    .sort((a, b) => b.areaHa - a.areaHa);

  return { crops: crops.sort((a, b) => (b.yieldIndex ?? -1) - (a.yieldIndex ?? -1)), byType };
}

function avisoDe(c: { areaHa: number | null; harvested: number | null; cost: number | null; costPerUnit: number | null; margin: number | null }, index: number | null): string | null {
  if (c.areaHa == null) return 'Sin superficie cargada: no hay nada por hectárea que comparar. Es el único dato que falta.';
  if (c.harvested == null || c.harvested === 0)
    return c.cost != null && c.cost > 0
      ? 'Hay labores con costo y todavía no se registró cosecha. El costo por hectárea ya es comparable; el rinde, no.'
      : 'Sin cosecha ni labores cargadas en el período.';
  if (c.margin != null && c.margin < 0) return 'El costo superó a lo que se cosechó al precio usado: este lote dio pérdida.';
  if (index != null && index <= 85) return `Rindió ${100 - index}% por debajo del promedio de este cultivo. Vale mirar qué tuvo distinto antes de repetirlo.`;
  return null;
}
