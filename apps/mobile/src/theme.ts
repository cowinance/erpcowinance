/**
 * Adaptador de tokens para React Native (P1.4.1, ADR-0013).
 *
 * `T` se DERIVA de la fuente canónica única (@cowinance/design-tokens); acá NO se
 * re-tipean valores hex, radios ni ningún token a mano. Preserva la API `T.*` y
 * los mismos valores que hoy (tema claro) → los ~15 consumidores no se tocan.
 * El móvil no usa `raised`/`accent`/`accentSoft`/`shadow`; se omiten como antes.
 */
import { primitive, semantic, radius } from '@cowinance/design-tokens';

const L = semantic.light;

export const T = {
  brand900: primitive.brand['900'],
  brand700: primitive.brand['700'],
  brand500: primitive.brand['500'],
  brand300: primitive.brand['300'],
  brand100: primitive.brand['100'],
  amber: primitive.amber['500'],

  canvas: L.bg.canvas,
  surface: L.bg.surface,
  sunken: L.bg.sunken,
  borderSubtle: L.border.subtle,
  borderStrong: L.border.strong,
  ink: L.text.primary,
  ink2: L.text.secondary,
  ink3: L.text.tertiary,

  success: L.status.success,
  warning: L.status.warning,
  danger: L.status.danger,
  info: L.status.info,

  radiusSm: radius.sm,
  radiusMd: radius.md,
  radiusLg: radius.lg,
};
