/**
 * El día de la FINCA en el móvil.
 *
 * **Esto era una copia paralela de la regla, y decidía lo contrario.** El dominio ya define el día
 * de trabajo (`packages/domain/src/time/farm-date.ts`) y dice, textual, que manda la zona de la
 * ORGANIZACIÓN y no la del dispositivo: el día pertenece a la finca, así que un veterinario que
 * carga desde otra provincia —o un técnico desde otro país— tiene que anotar en el día de la finca.
 * El servidor hace exactamente eso: `db.service.ts` pone esa zona en el `TimeZone` de la conexión,
 * así que TODA fecha calculada del lado del servidor sale de ahí.
 *
 * El móvil, en cambio, usaba la zona del dispositivo. Dos fuentes para una regla, y no coincidían:
 * el mismo parto cargado desde un teléfono en otro huso quedaba fechado un día distinto según quién
 * lo mirara. No era un problema de presentación —`captureDiagnosis` y `captureCalving` ESCRIBEN esa
 * fecha, y de ahí sale el parto probable— así que el error viajaba a la base y se quedaba.
 *
 * **Las dos razones que justificaban la copia ya no valen, y se verificaron una por una:**
 *
 * 1. «Pedirle la zona al servidor no funciona offline». Cierto, y por eso la zona NO se pide: viaja
 *    en el bootstrap y queda persistida en el dispositivo. Está disponible sin señal desde el
 *    primer ingreso, que de todos modos requiere red para bajar la finca.
 * 2. «`Intl` puede no traer los datos de internacionalización en este runtime». Se probó en el
 *    simulador con una sonda: el mismo instante da `Caracas=2026-07-29` y `Tokyo=2026-07-30`.
 *    Hermes respeta la zona. Era una precaución razonable, pero medida resultó innecesaria.
 *
 * **Por qué la zona vive acá y no se pasa por parámetro.** Una sesión es una finca: no hay caso en
 * que dos pantallas del mismo teléfono tengan que fechar en zonas distintas. Pasarla por argumento
 * obligaría a enhebrarla por cinco llamadores —dos adentro del sync, tres en pantallas— y la sexta
 * se olvidaría, que es la historia que este proyecto ya se comió con el teclado y con Dynamic Type.
 * Las funciones del dominio siguen siendo puras y reciben la zona; lo único que hay acá es dónde se
 * guarda la de esta sesión.
 *
 * **Sin zona conocida se usa la del dispositivo**, que es el comportamiento que había. Solo pasa
 * antes del primer bootstrap, cuando todavía no hay nada que fechar.
 */
import { farmToday as farmTodayEnZona, addFarmDays as sumarDiasDeFinca } from '@cowinance/domain';

export { sumarDiasDeFinca as addFarmDays };

/** La zona de la finca de ESTA sesión. `null` hasta que llega el bootstrap. */
let zonaDeLaFinca: string | null = null;

/** La fija el sync al hidratar la meta persistida y al bootstrapear. Vaciarla vuelve al dispositivo. */
export function setFarmTimeZone(tz: string | null | undefined): void {
  zonaDeLaFinca = typeof tz === 'string' && tz.trim() ? tz.trim() : null;
}

/** La zona vigente, para mostrarla en diagnóstico. `null` = todavía se usa la del dispositivo. */
export function getFarmTimeZone(): string | null {
  return zonaDeLaFinca;
}

/** La zona del dispositivo, que es el respaldo mientras no se conozca la de la finca. */
function zonaDelDispositivo(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Hoy en la finca. `now` inyectable para que los tests sean reproducibles. */
export function farmToday(d: Date = new Date()): string {
  return farmTodayEnZona(zonaDeLaFinca ?? zonaDelDispositivo(), d);
}
