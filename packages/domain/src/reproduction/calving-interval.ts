/**
 * Dos partos de la misma vaca no pueden estar más cerca que una gestación.
 *
 * **Por qué hace falta la regla.** El sistema aceptaba cualquier fecha de parto sin mirar el
 * historial de la vaca, y de ahí salían números que parecían buenos y no lo eran: seis partos en
 * tres años dan «479 kg destetados por año», casi el doble de lo que produce una vaca de verdad. El
 * número no chilla — se ve como una vaca excelente— y encima de un dato así se toman decisiones de
 * reposición al revés: se retiene a la que tiene la carga mal y se descarta a la buena.
 *
 * **Cuál es el piso.** Una vaca no puede parir dos veces separadas por menos de una gestación:
 * habría tenido que quedar preñada antes de parir. No es una heurística ni un promedio de la raza,
 * es una imposibilidad física, y por eso se puede afirmar sin conocer la finca. El intervalo REAL
 * bueno es bastante mayor —entre 12 y 14 meses—, pero eso es una meta de manejo y se juzga aparte:
 * mezclarlo acá convertiría una regla dura en una opinión discutible.
 *
 * **El error que suele haber detrás.** Casi siempre son mellizos cargados como dos partos, una
 * fecha mal tipeada, o el parto anotado en la vaca equivocada. Por eso el mensaje nombra al primero:
 * es el que más veces acierta y el que el productor puede corregir solo.
 *
 * Puro, sin IO ni relojes.
 */

import { GESTATION_DAYS } from './gestation';

/**
 * Días mínimos entre dos partos de la misma vaca.
 *
 * Es la gestación, no un número aparte: si mañana se parametriza por especie, este piso la sigue
 * sin que nadie tenga que acordarse de mover dos constantes.
 */
export const MIN_CALVING_INTERVAL_DAYS = GESTATION_DAYS;

const DAY_MS = 86_400_000;

/** Días entre dos fechas calendario. Sin husos: las dos son fechas, no instantes. */
function diasEntre(a: string, b: string): number {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.NaN;
  return Math.round(Math.abs(y - x) / DAY_MS);
}

export interface CalvingIntervalIssue {
  /** El parto ya registrado que está demasiado cerca. */
  readonly conflictsWith: string;
  readonly days: number;
  /** Qué pasó, en castellano y nombrando la causa más probable. */
  readonly message: string;
}

/**
 * ¿Este parto es posible, dado lo que la vaca ya tiene registrado?
 *
 * Mira TODAS las fechas y no solo la anterior: una carga histórica puede entrar desordenada, y un
 * parto nuevo con fecha vieja choca igual contra el que le sigue.
 */
export function calvingIntervalIssue(nuevaFecha: string, partosExistentes: readonly string[]): CalvingIntervalIssue | null {
  let peor: CalvingIntervalIssue | null = null;

  for (const fecha of partosExistentes) {
    const d = diasEntre(nuevaFecha, fecha);
    if (!Number.isFinite(d) || d >= MIN_CALVING_INTERVAL_DAYS) continue;
    if (peor === null || d < peor.days)
      peor = {
        conflictsWith: fecha,
        days: d,
        message:
          d === 0
            ? `Ya hay un parto registrado el ${fecha}. Si fueron mellizos, van como dos crías del MISMO parto.`
            : `Hay un parto el ${fecha}, a ${d} días de éste. Una vaca no puede parir dos veces con menos de ${MIN_CALVING_INTERVAL_DAYS} días de diferencia: ¿son mellizos cargados por separado, una fecha mal tipeada, o el parto de otra vaca?`,
      };
  }

  return peor;
}

/**
 * Los intervalos imposibles dentro de un historial ya cargado.
 *
 * Se usa para no calcular producción sobre datos que no pueden ser ciertos: una vaca con partos
 * imposibles tiene los kilos por año inflados, y ese número no se puede corregir solo — hay que
 * arreglar las fechas.
 */
export function impossibleCalvingIntervals(fechas: readonly string[]): { from: string; to: string; days: number }[] {
  const ordenadas = [...fechas].filter(Boolean).sort();
  const problemas: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < ordenadas.length; i++) {
    const d = diasEntre(ordenadas[i - 1], ordenadas[i]);
    if (Number.isFinite(d) && d < MIN_CALVING_INTERVAL_DAYS)
      problemas.push({ from: ordenadas[i - 1], to: ordenadas[i], days: d });
  }
  return problemas;
}
