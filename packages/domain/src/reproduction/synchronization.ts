/**
 * Respuesta a la sincronización: cuántas de las que se prepararon sirvieron.
 *
 * En un programa de transferencia se sincroniza un lote de receptoras, y el día de la transferencia
 * se revisa una por una: la que formó cuerpo lúteo recibe el embrión, la que no, no sirve. Esa
 * proporción es la que dice si el protocolo funcionó, si el momento estuvo bien elegido y si las
 * vacas estaban en condición — y es la que decide cuántas receptoras hay que preparar la próxima
 * vez para colocar los embriones que se tienen.
 *
 * Sin este número, el productor prepara vacas a ciegas: si responde el 50% y él sincroniza 20 para
 * 20 embriones, la mitad de los embriones se queda en el termo un año más.
 *
 * **El denominador es lo que hace honesto al número.** Se cuenta a TODAS las revisadas, no solo a
 * las que fallaron: una transferencia registrada ES la evidencia de que esa vaca respondió —no se
 * puede transferir sin cuerpo lúteo—, así que el sistema la cuenta sola.
 *
 * Puro, sin IO.
 */

export interface SyncResponseInput {
  /** Receptoras revisadas: las que respondieron más las que no. */
  readonly checked: number;
  readonly responded: number;
}

export interface SyncResponse {
  readonly checked: number;
  readonly responded: number;
  readonly notResponded: number;
  /** Porcentaje, o `null` cuando la muestra es tan chica que un número sería una invención. */
  readonly ratePct: number | null;
  /**
   * Cuántas receptoras hay que sincronizar para colocar un embrión, a esta tasa. Es la cuenta que
   * el productor hace antes de la próxima jornada, y la razón práctica de medir esto.
   */
  readonly recipientsPerEmbryo: number | null;
  /** Por qué no hay porcentaje, cuando no lo hay. Nunca se calla el motivo. */
  readonly caveat: string | null;
}

/**
 * Mínimo para publicar una tasa.
 *
 * Con tres receptoras, una que falla da 67% y dos dan 33%: el número salta treinta puntos por un
 * animal y sugiere una precisión que no existe. Es preferible mostrar los conteos crudos y decir
 * que todavía no alcanza, a publicar un porcentaje que invita a decidir sobre ruido.
 */
export const MIN_SYNC_SAMPLE = 8;

export function computeSyncResponse(input: SyncResponseInput): SyncResponse {
  const checked = Math.max(0, Math.trunc(Number(input.checked) || 0));
  const responded = Math.min(checked, Math.max(0, Math.trunc(Number(input.responded) || 0)));
  const notResponded = checked - responded;

  if (checked === 0)
    return { checked: 0, responded: 0, notResponded: 0, ratePct: null, recipientsPerEmbryo: null, caveat: 'Todavía no se revisó ninguna receptora.' };

  if (checked < MIN_SYNC_SAMPLE)
    return {
      checked,
      responded,
      notResponded,
      ratePct: null,
      recipientsPerEmbryo: null,
      caveat: `Con ${checked} receptoras revisadas el porcentaje se movería demasiado por cada animal. Hacen falta al menos ${MIN_SYNC_SAMPLE}.`,
    };

  const rate = (responded / checked) * 100;
  return {
    checked,
    responded,
    notResponded,
    ratePct: Math.round(rate * 10) / 10,
    // Sin ninguna respuesta no se divide: no es «infinitas receptoras», es que no se sabe.
    recipientsPerEmbryo: responded > 0 ? Math.round((checked / responded) * 10) / 10 : null,
    caveat: responded === 0 ? 'Ninguna receptora respondió: revisar el protocolo antes de la próxima jornada.' : null,
  };
}
