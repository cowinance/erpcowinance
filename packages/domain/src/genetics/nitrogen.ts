/**
 * Nitrógeno del termo (GT-4): la etapa que más plata protege de todo el vertical.
 *
 * Un termo que se queda sin nitrógeno **destruye todo lo que tiene adentro**, en silencio, y te
 * enterás cuando abrís. Puede haber años de genética ahí: es la pérdida de mayor consecuencia
 * económica del módulo, mucho mayor que cualquier error de inventario.
 *
 * Lo que se mide no es el nivel sino el CONSUMO, y de ahí sale lo único accionable: cuántos días
 * quedan y si todavía se llega a pedir la recarga.
 */

export class InvalidNitrogenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNitrogenError';
  }
}

/** Días que tarda el proveedor en traer el nitrógeno. Por debajo de esto, pedir ya llega tarde. */
export const DEFAULT_REFILL_LEAD_DAYS = 14;

export const NITROGEN_STATUSES = ['ok', 'warning', 'critical', 'unknown'] as const;
export type NitrogenStatus = (typeof NITROGEN_STATUSES)[number];

export interface NitrogenReading {
  /** ISO `YYYY-MM-DD`. */
  reading_date: string;
  level_cm: number;
}

export interface NitrogenState {
  level_cm: number | null;
  last_reading_date: string | null;
  last_refill_date: string | null;
  /** Centímetros por día. `null` si todavía no se puede medir el consumo. */
  daily_cm: number | null;
  days_remaining: number | null;
  projected_empty_date: string | null;
  status: NitrogenStatus;
  /** Por qué no se puede proyectar, cuando no se puede. Va a la pantalla tal cual. */
  reason: string | null;
}

const DIA = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DIA);
const sumarDias = (fecha: string, n: number) => new Date(Date.parse(fecha) + n * DIA).toISOString().slice(0, 10);

export function validateReading(raw: any): NitrogenReading {
  const fecha = typeof raw?.reading_date === 'string' ? raw.reading_date.slice(0, 10) : null;
  if (!fecha || Number.isNaN(Date.parse(fecha))) throw new InvalidNitrogenError("'reading_date' es obligatoria (YYYY-MM-DD)");
  const nivel = Number(raw?.level_cm);
  if (!Number.isFinite(nivel) || nivel < 0) throw new InvalidNitrogenError("'level_cm' debe ser un número mayor o igual a cero");
  return { reading_date: fecha, level_cm: nivel };
}

export interface RefillInput {
  refill_date: string;
  liters: number;
  level_after_cm: number | null;
}

export function validateRefill(raw: any): RefillInput {
  const fecha = typeof raw?.refill_date === 'string' ? raw.refill_date.slice(0, 10) : null;
  if (!fecha || Number.isNaN(Date.parse(fecha))) throw new InvalidNitrogenError("'refill_date' es obligatoria (YYYY-MM-DD)");
  const litros = Number(raw?.liters);
  if (!Number.isFinite(litros) || litros <= 0) throw new InvalidNitrogenError("'liters' debe ser un número mayor que cero");
  const nivel = raw?.level_after_cm == null || raw.level_after_cm === '' ? null : Number(raw.level_after_cm);
  if (nivel !== null && (!Number.isFinite(nivel) || nivel < 0))
    throw new InvalidNitrogenError("'level_after_cm' debe ser un número mayor o igual a cero");
  return { refill_date: fecha, liters: litros, level_after_cm: nivel };
}

/**
 * Estado del termo a partir de sus mediciones.
 *
 * EL CONSUMO SOLO SE PUEDE MEDIR ENTRE RECARGAS. Una recarga sube el nivel, así que mezclar
 * mediciones de antes y de después daría un consumo negativo —el termo "ganando" nitrógeno— y una
 * proyección sin sentido, justo en el dato del que depende no perder la genética. Por eso se
 * descartan las mediciones anteriores a la última recarga.
 *
 * El umbral es sobre los DÍAS QUE QUEDAN, no sobre el nivel. Un termo al 20 % puede estar tranquilo
 * si consume poco, y uno al 50 % puede ser una urgencia si evapora rápido: lo que decide es si
 * todavía se llega a pedir y recibir la recarga.
 */
export function computeNitrogenState(
  readings: readonly NitrogenReading[],
  lastRefillDate: string | null,
  leadDays: number = DEFAULT_REFILL_LEAD_DAYS,
): NitrogenState {
  const ordenadas = [...readings].sort((a, b) => a.reading_date.localeCompare(b.reading_date));
  const ultima = ordenadas[ordenadas.length - 1] ?? null;

  const base: NitrogenState = {
    level_cm: ultima?.level_cm ?? null,
    last_reading_date: ultima?.reading_date ?? null,
    last_refill_date: lastRefillDate,
    daily_cm: null,
    days_remaining: null,
    projected_empty_date: null,
    status: 'unknown',
    reason: null,
  };

  if (!ultima) return { ...base, reason: 'Todavía no se cargó ninguna medición de nivel.' };

  // Solo el ciclo vigente: lo anterior a la recarga describe un termo que ya no existe.
  const cicloActual = lastRefillDate ? ordenadas.filter((r) => r.reading_date >= lastRefillDate) : ordenadas;
  if (cicloActual.length < 2)
    return { ...base, reason: 'Falta una segunda medición desde la última recarga para saber cuánto evapora.' };

  const primera = cicloActual[0];
  const transcurridos = dias(primera.reading_date, ultima.reading_date);
  if (transcurridos <= 0)
    return { ...base, reason: 'Las mediciones del ciclo son del mismo día: todavía no hay tiempo para medir consumo.' };

  const caida = primera.level_cm - ultima.level_cm;
  if (caida <= 0)
    // Sin caída no hay nada que proyectar. Suele ser una recarga sin registrar, y decirlo es más
    // útil que inventar una fecha de vacío.
    return {
      ...base,
      daily_cm: 0,
      reason: 'El nivel no bajó entre mediciones. Si hubo una recarga, registrala para volver a medir el consumo.',
    };

  const daily = caida / transcurridos;
  const restantes = Math.floor(ultima.level_cm / daily);
  return {
    ...base,
    daily_cm: Math.round(daily * 1000) / 1000,
    days_remaining: restantes,
    projected_empty_date: sumarDias(ultima.reading_date, restantes),
    status: restantes <= leadDays ? 'critical' : restantes <= leadDays * 2 ? 'warning' : 'ok',
    reason: null,
  };
}

/**
 * El texto de la alerta, en el idioma del productor.
 *
 * Vive en el dominio porque lo tienen que decir igual el motor de alertas, la pantalla del termo y
 * la tarea de recarga. Y dice la CONSECUENCIA, no el número: «quedan 9 días» no explica por qué hay
 * que soltar lo que se está haciendo.
 */
export function nitrogenAlertMessage(state: NitrogenState, tankCode: string, leadDays: number = DEFAULT_REFILL_LEAD_DAYS): string {
  if (state.days_remaining === null) return `Termo ${tankCode}: sin datos suficientes para proyectar el nitrógeno.`;
  const cuando = state.projected_empty_date ? ` (vacío estimado el ${state.projected_empty_date})` : '';
  if (state.status === 'critical')
    return `Termo ${tankCode}: quedan ${state.days_remaining} días de nitrógeno${cuando}. El proveedor tarda ${leadDays}: pedí la recarga hoy o se pierde todo lo que hay adentro.`;
  return `Termo ${tankCode}: quedan ${state.days_remaining} días de nitrógeno${cuando}. Conviene pedir la recarga ahora.`;
}
