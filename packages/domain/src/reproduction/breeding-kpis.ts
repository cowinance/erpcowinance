/**
 * Índices de eficiencia del rodeo de CRÍA (C3 · cría y recría) — DERIVADOS, regla única. Distinto del
 * reporte reproductivo de flujo (P9, `reports.service.reproduction`, que cuenta servicios/preñeces/
 * partos/destetes de un período): acá se derivan las *tasas* que miden la eficiencia del rodeo de cría.
 *
 * - `pregnancyRate`: % de preñez sobre entoradas (preñeces / vientres entorados).
 * - `weaningRate`: ternero destetado por vaca entorada (destetes / vientres entorados). El índice
 *   productivo por excelencia de la cría; puede pasar de 1 (varios ciclos) o quedar por debajo.
 * - `replacementRate`: % de reposición (vaquillonas / vacas) — estructura del rodeo, no de período.
 * - `kgWeanedPerHa`: kilos destetados por hectárea (Σ peso al destete / superficie).
 *
 * Todas devuelven null cuando el denominador es 0 (no se inventa un cociente sin base).
 */
export interface BreedingKpisInput {
  servicedFemales: number;
  pregnancies: number;
  weanings: number;
  weanedKg: number;
  breedingCows: number;
  replacementHeifers: number;
  totalHa: number;
}

export interface BreedingKpis {
  pregnancyRate: number | null;
  weaningRate: number | null;
  replacementRate: number | null;
  kgWeanedPerHa: number | null;
}

const num = (v: unknown): number => Number(v);
const round = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
};
/** Cociente seguro: null si el divisor no es un positivo finito. */
const ratio = (a: number, b: number, digits: number): number | null =>
  Number.isFinite(b) && b > 0 && Number.isFinite(a) ? round(a / b, digits) : null;

export function computeBreedingKpis(input: BreedingKpisInput): BreedingKpis {
  const serviced = num(input.servicedFemales);
  const pct = (a: number, b: number): number | null => {
    const r = ratio(a, b, 4);
    return r == null ? null : round(r * 100, 1);
  };
  return {
    pregnancyRate: pct(num(input.pregnancies), serviced),
    weaningRate: ratio(num(input.weanings), serviced, 3),
    replacementRate: pct(num(input.replacementHeifers), num(input.breedingCows)),
    kgWeanedPerHa: ratio(num(input.weanedKg), num(input.totalHa), 1),
  };
}
