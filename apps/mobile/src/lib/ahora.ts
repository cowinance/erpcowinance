import { useState } from 'react';

/**
 * Un instante ESTABLE para el render.
 *
 * Llamar a `Date.now()` mientras se dibuja hace que el resultado dependa del reloj, y con el React
 * Compiler activado eso es un error de verdad y no un detalle: el compilador puede memorizar el
 * render, y entonces lo que se ve queda congelado en el momento en que se calculó —o peor, cambia
 * sin que ningún estado haya cambiado—.
 *
 * Este hook captura el instante UNA vez, al montar, y lo deja en estado. Sirve para lo que se mide
 * en días («hace 12 días que no se pesa»), donde que el número sea de hace unos minutos no cambia
 * nada. **No sirve para un contador que tiene que avanzar**: eso necesita su propio estado y quien
 * lo actualice.
 */
export function useAhora(): number {
  const [ahora] = useState(() => Date.now());
  return ahora;
}

/** Días enteros transcurridos entre un instante ISO y `ahora`. `null` si no hay fecha. */
export function diasDesde(iso: string | null | undefined, ahora: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((ahora - t) / 86_400_000);
}
