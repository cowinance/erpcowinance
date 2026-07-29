/**
 * Un progenitor no puede haber nacido después que su cría.
 *
 * **Qué se aceptaba.** El sistema verificaba tres cosas del vínculo —que el progenitor exista, que
 * el sexo corresponda, y que no se arme un ciclo— pero no miraba las fechas. Comprobado contra la
 * app: se pudo poner como madre a una vaca nacida en 2025 de una hija nacida en 2017. Ocho años
 * después.
 *
 * **Por qué importa más allá de la ficha.** Ese árbol lo recorren tres cálculos del sistema: el
 * coeficiente de consanguinidad de Wright —que sube seis generaciones—, los kilos destetados por
 * madre y por año, y el asesor que recomienda con qué toro servir. Los tres devuelven un número
 * perfectamente formateado sobre un pedigrí que no puede ser cierto, y ninguno tiene forma de
 * sospecharlo.
 *
 * **Dónde está el piso.** No en «nacer antes», que sería insuficiente: una madre que nació cien días
 * antes que su cría tampoco pudo gestarla. El progenitor tuvo que existir en la CONCEPCIÓN, o sea al
 * menos una gestación antes del parto. Vale igual para la madre —que la llevó adentro— y para el
 * padre, que tuvo que estar ahí para engendrarla.
 *
 * Es una imposibilidad física, no una opinión de manejo, y por eso se puede afirmar sin conocer la
 * finca. La edad al primer parto —24 meses, 30 meses, según la raza y el sistema— es una META, se
 * discute, y mezclarla acá convertiría una regla dura en algo opinable. Es exactamente el criterio
 * con el que se eligió el piso del intervalo entre partos, y por eso las dos reglas comparten la
 * misma constante.
 *
 * Sin fecha en alguno de los dos no se valida nada: un animal comprado sin fecha de nacimiento es lo
 * más normal del mundo, y rechazar su genealogía por un dato que nadie tiene sería peor que el
 * problema.
 *
 * Puro, sin IO ni relojes.
 */

import { GESTATION_DAYS } from './gestation';

const DAY_MS = 86_400_000;

export interface ParentageChronologyIssue {
  /** Qué pasa, en castellano y nombrando las dos fechas: sin ellas no se puede corregir. */
  readonly message: string;
  /** Días que le faltan al progenitor para haber podido serlo. Útil para ordenar por gravedad. */
  readonly shortByDays: number;
}

/** Días entre dos fechas calendario. Sin husos: las dos son días, no instantes. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / DAY_MS);
}

/**
 * ¿Este progenitor pudo serlo, por fechas?
 *
 * `null` si sí, o si falta alguna de las dos fechas.
 */
export function parentageChronologyIssue(
  parentBirthDate: string | null | undefined,
  childBirthDate: string | null | undefined,
  relacion: 'madre' | 'padre' = 'madre',
): ParentageChronologyIssue | null {
  if (!parentBirthDate || !childBirthDate) return null;
  const nacimientoProgenitor = String(parentBirthDate).slice(0, 10);
  const nacimientoCria = String(childBirthDate).slice(0, 10);

  const diferencia = diasEntre(nacimientoProgenitor, nacimientoCria);
  if (!Number.isFinite(diferencia)) return null;
  if (diferencia >= GESTATION_DAYS) return null;

  const faltan = GESTATION_DAYS - diferencia;
  const detalle =
    diferencia < 0
      ? `nació DESPUÉS que la cría`
      : `nació ${diferencia} días antes que la cría, y una gestación son ${GESTATION_DAYS}`;

  return {
    shortByDays: faltan,
    message: `La ${relacion} (${nacimientoProgenitor}) ${detalle}. Revisá las fechas o la caravana: no pudo haber engendrado a un animal nacido el ${nacimientoCria}.`,
  };
}
