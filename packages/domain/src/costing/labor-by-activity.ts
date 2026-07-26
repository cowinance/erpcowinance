/**
 * En qué se va la mano de obra (Fase 3.4).
 *
 * Los partes de trabajo ya se valorizan y se imputan a un centro de costo (E6): cuánto cuesta la
 * mano de obra DE ESE LOTE. Falta el otro corte, que es el que decide una contratación: **en qué
 * clase de trabajo se van las horas**. Sanidad, reproducción, alimentación, mantenimiento. Es la
 * pregunta previa a «¿me conviene tomar otro empleado o tercerizar esto?».
 *
 * Ojo con el nombre: en Costos, «actividad» ya significa carne / leche / agricultura (el costo
 * unitario, E2). Acá se habla de otra cosa —el TIPO DE TRABAJO—, y por eso el módulo no reusa esa
 * palabra. Dos números distintos con el mismo nombre es la forma más rápida de que nadie crea en
 * ninguno de los dos.
 *
 * El riesgo específico que esta regla ataja: un empleado sin tarifa horaria cargada aporta horas
 * pero no costo. Si la mitad de las horas de mantenimiento las hace alguien sin tarifa, la
 * actividad se ve barata y la conclusión —«nos conviene hacerlo nosotros»— sale al revés. Por eso
 * la cobertura viaja pegada al costo y no en otra pantalla.
 *
 * Puro, sin IO.
 */

export interface ActivityLaborInput {
  /** Clave del tipo de trabajo. `null` = jornadas sin tarea vinculada. */
  activity: string | null;
  /** Horas con tarifa, ya valorizadas. */
  pricedHours: number;
  /** Costo de esas horas. */
  cost: number;
  /** Horas de empleados SIN tarifa horaria: trabajo real que el sistema no puede poner en pesos. */
  unpricedHours: number;
}

export interface ActivityLabor {
  activity: string | null;
  hours: number;
  pricedHours: number;
  unpricedHours: number;
  cost: number;
  /** Costo por hora de ESTA actividad. Difiere entre actividades cuando las hace gente distinta. */
  costPerHour: number | null;
  /** Porción del costo laboral total del período. `null` si no hay costo total que repartir. */
  sharePct: number | null;
  /** Horas con tarifa sobre el total de horas: qué tan completo es el costo de arriba. */
  coveragePct: number;
  /** Aviso cuando el número de arriba subestima el costo real. */
  caveat: string | null;
}

export interface LaborByActivity {
  rows: ActivityLabor[];
  totals: {
    hours: number;
    cost: number;
    unpricedHours: number;
    /** Horas sin tarea vinculada: existen, pero no se sabe en qué se fueron. */
    hoursWithoutActivity: number;
    coveragePct: number;
  };
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Umbral de cobertura por debajo del cual el costo de una actividad deja de ser comparable.
 *
 * Es una convención de lectura, no una ley: con menos del 80% de las horas valorizadas, la
 * diferencia entre dos actividades puede deberse a quién tiene tarifa cargada y no a lo que
 * realmente cuestan.
 */
export const COVERAGE_WARNING_PCT = 80;

export function summarizeLaborByActivity(input: ActivityLaborInput[]): LaborByActivity {
  const filas = input.map((r) => {
    const priced = num(r.pricedHours);
    const unpriced = num(r.unpricedHours);
    const hours = round2(priced + unpriced);
    const cost = round2(num(r.cost));
    return { activity: r.activity ?? null, hours, pricedHours: round2(priced), unpricedHours: round2(unpriced), cost };
  });

  const costoTotal = filas.reduce((s, r) => s + r.cost, 0);
  const horasTotales = filas.reduce((s, r) => s + r.hours, 0);
  const horasConTarifa = filas.reduce((s, r) => s + r.pricedHours, 0);

  const rows = filas.map<ActivityLabor>((r) => {
    const costPerHour = r.pricedHours > 0 ? round2(r.cost / r.pricedHours) : null;
    // Sin costo total no se reparte nada: un 100% sobre cero se leería como «acá se va todo».
    const sharePct = costoTotal > 0 ? round2((r.cost / costoTotal) * 100) : null;
    const coveragePct = r.hours > 0 ? round2((r.pricedHours / r.hours) * 100) : 0;
    return { ...r, costPerHour, sharePct, coveragePct, caveat: avisoDe(r.activity, coveragePct, r.unpricedHours) };
  });

  // De mayor a menor costo: la conversación sobre contratar o tercerizar empieza por arriba.
  // Las jornadas sin actividad van últimas — no son la actividad más barata, son las que no se sabe
  // en qué se fueron, y mezclarlas con el resto invitaría a leerlas como una categoría más.
  rows.sort((a, b) => (a.activity == null ? 1 : b.activity == null ? -1 : b.cost - a.cost));

  return {
    rows,
    totals: {
      hours: round2(horasTotales),
      cost: round2(costoTotal),
      unpricedHours: round2(horasTotales - horasConTarifa),
      hoursWithoutActivity: round2(rows.filter((r) => r.activity == null).reduce((s, r) => s + r.hours, 0)),
      coveragePct: horasTotales > 0 ? round2((horasConTarifa / horasTotales) * 100) : 0,
    },
  };
}

function avisoDe(activity: string | null, coveragePct: number, unpricedHours: number): string | null {
  if (activity == null)
    return 'Jornadas sin tarea vinculada: las horas están, pero no se sabe en qué se fueron. Vincular el parte a una tarea es lo único que falta para que entren en la comparación.';
  if (unpricedHours > 0 && coveragePct < COVERAGE_WARNING_PCT)
    return `Solo el ${coveragePct}% de las horas tiene tarifa cargada, así que este costo está por debajo del real. Cargar la tarifa de los empleados que faltan cambia la comparación con un tercero.`;
  return null;
}
