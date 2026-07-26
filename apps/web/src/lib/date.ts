/**
 * El día de la FINCA en el navegador.
 *
 * Reemplaza al viejo `toISOString().slice(0, 10)`, que da la fecha de UTC: en Venezuela (UTC−4)
 * eso hacía que después de las 20:00 los selectores propusieran el día siguiente y que la agenda
 * mostrara «hoy» equivocado.
 *
 * De dónde sale la zona, en orden:
 *
 *  1. `data-farm-tz` del `<html>`, que el layout llena con la de la organización. Es la que manda:
 *     un veterinario que carga desde otra provincia tiene que anotar en el día de la finca.
 *  2. La del propio dispositivo. Para quien está parado en la finca —el caso normal— es la misma,
 *     y como respaldo es mucho mejor que UTC: falla solo si el equipo está mal configurado.
 *
 * Nunca UTC: usarlo de respaldo sería volver al bug.
 */
export function farmTimeZone(): string {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.farmTz;
    if (attr) return attr;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** `YYYY-MM-DD` de un instante, en la zona de la finca. */
export function toFarmDate(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: farmTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    // Una zona inválida no puede romper una pantalla: se cae a la del dispositivo.
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

/** Hoy en la finca. */
export const farmToday = (): string => toFarmDate();

/**
 * Suma días sobre una fecha calendario. Igual que en el dominio: se opera sobre el calendario y no
 * sumando milisegundos, porque el día en que cambia el horario de verano dura 23 o 25 horas y la
 * cuenta se corre un día.
 */
export function addFarmDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000).toISOString().slice(0, 10);
}
