/**
 * Cuánto hace que se armó lo que se está mirando, en el idioma del productor.
 *
 * Vive aparte del componente porque tiene un borde que no se ve mirando la pantalla: el reloj del
 * DISPOSITIVO puede estar atrasado respecto del servidor. Un teléfono de campo que perdió la hora
 * daría una diferencia negativa, y «actualizado hace -3 minutos» es peor que no decir nada — el
 * productor deja de creerle al cartel, y el cartel existe justamente para que le crea.
 *
 * Puro, sin relojes: el instante actual entra por parámetro.
 */

/** Minutos transcurridos, nunca negativos. Un reloj atrasado se lee como «recién». */
export function minutesSince(at: string | Date, now: number): number {
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 60_000));
}

/**
 * El texto. Se corta en horas porque «hace 143 min» no se lee: nadie divide por 60 mirando una
 * pantalla, y a esa altura el número exacto ya no cambia ninguna decisión.
 */
export function describeAge(minutos: number): string {
  if (minutos < 1) return 'Actualizado recién';
  if (minutos < 60) return `Actualizado hace ${minutos} min`;
  return `Actualizado hace ${Math.floor(minutos / 60)} h`;
}

/**
 * A partir de cuándo el aviso se hace notar.
 *
 * Cinco minutos: antes de eso el riesgo es molestar, y después pasa a ser que el productor le crea a
 * un número viejo. Sobre una agenda del día —«tareas vencidas 0»— esa diferencia es la que importa.
 */
export const STALE_MINUTES = 5;
