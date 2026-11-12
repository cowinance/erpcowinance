/**
 * Contraste de color, según WCAG 2.1.
 *
 * Vive en el paquete de tokens y no en una app porque la paleta es una sola: si el contraste se
 * midiera en la web, el móvil podría empeorarlo sin que nadie se entere, y al revés.
 *
 * El motivo no es cumplir una norma. Esta app se usa **con el teléfono al sol**, en un corral, y
 * ahí un gris claro sobre blanco simplemente no existe. WCAG da el número con el que se puede
 * discutir eso sin opinar.
 */

/** Umbral de WCAG AA para texto normal. */
export const AA_TEXTO = 4.5;
/** AA para texto grande (≥ 24 px, o ≥ 18,66 px en negrita). */
export const AA_TEXTO_GRANDE = 3;
/** WCAG 2.1 para bordes y controles que son el único indicio visual de un elemento. */
export const AA_NO_TEXTO = 3;

/** Canal sRGB linealizado. */
function canal(valor: number): number {
  const s = valor / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** `#rgb` o `#rrggbb` → [r, g, b] en 0..255. */
export function aRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const largo = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(largo)) throw new Error(`No es un color hexadecimal: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(largo.slice(i, i + 2), 16)) as [number, number, number];
}

/** Luminancia relativa (WCAG 2.1 §relative luminance). */
export function luminancia(hex: string): number {
  const [r, g, b] = aRgb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * Razón de contraste entre dos colores, de 1 (iguales) a 21 (negro sobre blanco).
 * El orden no importa: es simétrica.
 */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Redondeado a dos decimales, que es la precisión con la que tiene sentido hablar de esto. */
export function contrasteRedondeado(a: string, b: string): number {
  return Math.round(contraste(a, b) * 100) / 100;
}
