/**
 * El día del CAMPO, no el de UTC.
 *
 * `new Date().toISOString().slice(0, 10)` da la fecha de UTC: en Venezuela (UTC−4) todo lo cargado
 * después de las 20:00 quedaba fechado al día siguiente. Encerrar y trabajar al atardecer es lo
 * normal, así que el error caía justo sobre la captura de campo.
 *
 * Acá manda **la zona del dispositivo**, y a diferencia de la web no es una aproximación: el móvil
 * existe para cargar parado en el potrero, así que el teléfono está en la zona de la finca. Además
 * es la única opción que funciona OFFLINE, que es cuando esta app tiene que servir — pedirle la
 * zona al servidor no es una opción cuando no hay señal.
 *
 * Se usan `getFullYear/getMonth/getDate`, que ya son locales, en vez de `Intl`: no depende de que
 * el runtime traiga los datos de internacionalización.
 */
export function farmToday(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Suma días sobre una fecha calendario.
 *
 * Sobre el calendario y no sumando milisegundos: el día en que cambia el horario de verano dura 23
 * o 25 horas y la cuenta se corre un día.
 */
export function addFarmDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}
