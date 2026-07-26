/**
 * El día de la FINCA, no el del meridiano de Greenwich.
 *
 * Toda la app venía calculando fechas con `new Date().toISOString().slice(0, 10)`, que es UTC
 * siempre, sin importar dónde esté el servidor ni el teléfono. En Venezuela (UTC−4) eso significa
 * que **todo lo cargado después de las 20:00 se fechaba al día siguiente**: un tratamiento aplicado
 * a las 20:30 del 26 quedaba registrado el 27.
 *
 * No es un detalle de presentación. El día es la unidad de trabajo de una finca —la recorrida de
 * hoy, el ordeñe de hoy, la tarea de hoy— y también la unidad contable: una venta del 31 a las 21
 * caía en el mes siguiente. Encerrar un rodeo al atardecer es lo normal, no la excepción.
 *
 * **Manda la zona de la ORGANIZACIÓN, no la del dispositivo.** El día de trabajo pertenece a la
 * finca: un veterinario que carga desde otra provincia —o un técnico desde otro país— tiene que
 * anotar en el día de la finca, no en el suyo. El modelo ya lo venía diciendo: `organizations.timezone`
 * se guarda al registrar (derivada del país) y hasta ahora no lo leía nadie.
 *
 * Puro, sin IO.
 */

/** Zona de referencia cuando la organización no tiene una válida. */
export const FALLBACK_TIME_ZONE = 'UTC';

/**
 * `true` si la zona la entiende este runtime.
 *
 * Se valida porque el valor viaja hasta un `set_config('TimeZone', …)` de PostgreSQL y hasta un
 * `Intl.DateTimeFormat`: una cadena inventada rompería el primero y haría lanzar al segundo, y una
 * fecha que revienta a las 20:00 es el peor momento para descubrirlo.
 */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** La zona si es usable; si no, UTC. Nunca lanza: una zona mal cargada no puede tumbar la app. */
export function safeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? (tz as string) : FALLBACK_TIME_ZONE;
}

/**
 * La fecha calendario (`YYYY-MM-DD`) de un instante, en la zona de la finca.
 *
 * Se usa `en-CA` porque su formato corto ES el ISO de fecha; armarlo a mano con `getFullYear` y
 * amigos daría la zona del proceso, que es justamente lo que hay que dejar de mirar.
 */
export function toFarmDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Una fecha calendario ya normalizada: `2026-07-26`. Sin hora y, por lo tanto, sin zona. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lleva a fecha de finca un valor que puede ser **un instante o una fecha calendario**.
 *
 * La distinción no es cosmética y es la que rompe todo cuando se ignora: **una fecha calendario no
 * tiene zona horaria**. `2026-07-26` es el 26 en cualquier parte del mundo. Pasarla por una
 * conversión de zona la interpreta como medianoche UTC y la corre: en Buenos Aires (UTC−3) esa
 * medianoche son las 21:00 del 25, así que «26» se convierte en «25» y todo lo que se cuente desde
 * ahí sale un día antes.
 *
 * Un INSTANTE sí tiene zona (`2026-07-26T20:30:00Z` es de un día o del otro según dónde se mire) y
 * ése es el que hay que convertir.
 *
 * Por eso: si ya viene como fecha, se devuelve intacta; si viene como instante, se convierte.
 */
export function asFarmDate(value: string | Date, timeZone: string): string {
  if (typeof value === 'string' && SOLO_FECHA.test(value)) return value;
  return toFarmDate(value instanceof Date ? value : new Date(value), timeZone);
}

/** Hoy en la finca. El `now` se puede inyectar para que los tests sean reproducibles. */
export function farmToday(timeZone: string, now: Date = new Date()): string {
  return toFarmDate(now, timeZone);
}

/**
 * Suma días sobre una fecha calendario, sin pasar por husos ni horarios de verano.
 *
 * `new Date(fecha).getTime() + n*86400000` parece equivalente y no lo es: en el día que cambia el
 * horario de verano tiene 23 o 25 horas, y el cálculo se corre un día. Acá se opera sobre el
 * calendario en UTC —donde todos los días miden lo mismo— y se devuelve calendario, así que la
 * aritmética es exacta en cualquier zona.
 */
export function addFarmDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
