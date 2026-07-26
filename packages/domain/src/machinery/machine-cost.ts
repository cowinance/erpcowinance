/**
 * Lo que cuesta cada máquina por hora de uso (Fase 4).
 *
 * Maquinaria registra combustible, mantenimiento y horómetro, y hasta acá no cruzaba nada: se sabía
 * cuánto se gastó y no cuánto CUESTA USARLA. Es la diferencia entre un archivo de comprobantes y la
 * información que decide si conviene arreglarla, reemplazarla o alquilar.
 *
 * Tres decisiones sostienen que el número sirva:
 *
 * 1. **La unidad la manda la máquina, no el reporte.** Un tractor se mide en horas y un camión en
 *    kilómetros. Un «costo por hora» de camión es un número sin significado, y peor: es comparable
 *    de mentira contra el del tractor. La unidad viaja en la respuesta y NUNCA se mezclan.
 *
 * 2. **Sin dos lecturas del medidor no hay uso que dividir.** Si nadie anotó el horómetro al cargar
 *    combustible, el costo por hora no existe. Devolver el costo total disfrazado de costo unitario
 *    sería el peor resultado posible: se ve razonable y está mal.
 *
 * 3. **El correctivo se separa del preventivo.** Dos máquinas con el mismo costo por hora no son la
 *    misma máquina si una gasta en service programado y la otra en roturas. Esa proporción es la
 *    que anticipa el problema, y es lo que el costo total solo esconde.
 *
 * Puro, sin IO.
 */

/** Con qué se mide el uso. `null` = no hay lecturas suficientes de ningún medidor. */
export type UsageMeter = 'hours' | 'km';

export interface MachineCostInput {
  /** Lecturas de horómetro dentro del período (de cargas y de services). */
  hourReadings: number[];
  /** Lecturas de odómetro dentro del período. */
  kmReadings: number[];
  fuelCost: number | null;
  fuelLiters: number | null;
  /** Costo de mantenimiento preventivo + inspecciones. */
  preventiveCost: number | null;
  /** Costo de mantenimiento correctivo: roturas. */
  correctiveCost: number | null;
}

export interface MachineCost {
  meter: UsageMeter | null;
  /** Uso del período en la unidad de `meter`. `null` si no se puede establecer. */
  usage: number | null;
  fuelCost: number;
  maintenanceCost: number;
  totalCost: number;
  /** Costo total por hora o por kilómetro. La comparación entre máquinas se hace con esto. */
  costPerUnit: number | null;
  /** Consumo: litros por hora o por km. Sube antes que nada cuando el motor empieza a fallar. */
  fuelPerUnit: number | null;
  /**
   * Qué parte del mantenimiento fue por rotura. `null` si no hubo mantenimiento en el período —
   * distinto de 0%, que significa «hubo gasto y todo fue programado».
   */
  correctiveSharePct: number | null;
  caveat: string | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
const money = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? round2(v) : 0;
};

/**
 * Uso derivado de las lecturas del medidor: la última menos la primera.
 *
 * Se descartan las lecturas no positivas y se exige que haya al menos dos distintas. Un medidor que
 * no se movió entre dos cargas significa que alguien copió el número anterior, no que la máquina
 * trabajó cero: dividir por eso daría infinito.
 */
export function usageFromReadings(readings: number[]): number | null {
  const validas = readings.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (validas.length < 2) return null;
  const uso = round3(validas[validas.length - 1] - validas[0]);
  return uso > 0 ? uso : null;
}

/**
 * Umbral de correctivo que amerita nombrarlo. Convención de lectura: por encima de la mitad, la
 * máquina se está gastando en roturas y no en cuidarla.
 */
export const CORRECTIVE_WARNING_PCT = 50;

export function computeMachineCost(input: MachineCostInput): MachineCost {
  const fuelCost = money(input.fuelCost);
  const preventive = money(input.preventiveCost);
  const corrective = money(input.correctiveCost);
  const maintenanceCost = round2(preventive + corrective);
  const totalCost = round2(fuelCost + maintenanceCost);

  // Horas primero: es la unidad de casi toda la maquinaria de campo. El kilómetro solo entra cuando
  // la máquina no lleva horómetro, que es el caso del camión.
  const porHora = usageFromReadings(input.hourReadings);
  const porKm = porHora == null ? usageFromReadings(input.kmReadings) : null;
  const meter: UsageMeter | null = porHora != null ? 'hours' : porKm != null ? 'km' : null;
  const usage = porHora ?? porKm;

  const costPerUnit = usage != null && usage > 0 ? round2(totalCost / usage) : null;
  const litros = Number(input.fuelLiters);
  const fuelPerUnit = usage != null && usage > 0 && Number.isFinite(litros) && litros > 0 ? round2(litros / usage) : null;
  const correctiveSharePct = maintenanceCost > 0 ? round2((corrective / maintenanceCost) * 100) : null;

  return {
    meter,
    usage,
    fuelCost,
    maintenanceCost,
    totalCost,
    costPerUnit,
    fuelPerUnit,
    correctiveSharePct,
    caveat: avisoDe(meter, usage, correctiveSharePct, totalCost),
  };
}

function avisoDe(meter: UsageMeter | null, usage: number | null, correctivePct: number | null, totalCost: number): string | null {
  if (meter == null || usage == null)
    return totalCost > 0
      ? 'Hay gasto cargado pero no dos lecturas del horómetro o del odómetro en el período: no se puede saber cuánto se usó, así que no hay costo por hora. Anotar el medidor al cargar combustible es lo único que falta.'
      : 'Sin gasto ni lecturas del medidor en el período.';
  if (correctivePct != null && correctivePct > CORRECTIVE_WARNING_PCT)
    return `El ${correctivePct}% del mantenimiento fue por rotura, no por service programado. Una máquina que se arregla más de lo que se cuida suele estar avisando algo que el costo total solo no muestra.`;
  return null;
}

/**
 * Compara máquinas entre sí, SOLO dentro de la misma unidad de medida.
 *
 * Poner un tractor medido en horas y un camión medido en kilómetros en el mismo ranking daría un
 * orden con apariencia de sentido y sin ninguno. Por eso devuelve grupos separados, y las máquinas
 * sin uso medible quedan aparte: no son las más baratas, son las que no se pudieron medir.
 */
export function groupMachinesByMeter<T extends { cost: MachineCost }>(machines: T[]): { hours: T[]; km: T[]; unmeasured: T[] } {
  const porCosto = (a: T, b: T) => (b.cost.costPerUnit ?? 0) - (a.cost.costPerUnit ?? 0);
  return {
    hours: machines.filter((m) => m.cost.meter === 'hours' && m.cost.costPerUnit != null).sort(porCosto),
    km: machines.filter((m) => m.cost.meter === 'km' && m.cost.costPerUnit != null).sort(porCosto),
    unmeasured: machines.filter((m) => m.cost.costPerUnit == null),
  };
}
