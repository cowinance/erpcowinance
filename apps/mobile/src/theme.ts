/**
 * Adaptador de tokens para React Native (P1.4.1, ADR-0013).
 *
 * `T` se DERIVA de la fuente canónica única (@cowinance/design-tokens); acá NO se
 * re-tipean valores hex, radios ni ningún token a mano. Preserva la API `T.*` y
 * los mismos valores que hoy (tema claro) → los ~15 consumidores no se tocan.
 * El móvil no usa `raised`/`accent`/`accentSoft`; se omiten como antes.
 *
 * La SOMBRA sí se usa ahora. Antes se omitía por una razón real: en la fuente vivía
 * solo como cadena CSS (`0 4px 12px rgba(...)`), que React Native no entiende. Los
 * números ya están en `elevation`, así que acá se traducen a props nativas sin
 * re-tipear ningún valor.
 */
import { primitive, semantic, radius, typeRole, typeCompat, space, elevation, type Elevation } from '@cowinance/design-tokens';

/** Traduce una elevación de la fuente canónica a las props que entiende React Native. */
function rnShadow(e: Elevation | null) {
  if (!e) return {};
  return {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: e.y },
      shadowOpacity: e.opacity,
      shadowRadius: e.blur / 2,
      elevation: e.y,
    } as const;
  }

  /**
   * La paleta para UN esquema.
   *
   * Antes esto era `const L = semantic.light` y un objeto `T` congelado al importar. El modo oscuro
   * necesita lo contrario: `useColorScheme()` cambia EN CALIENTE —el sistema pasa a oscuro al
   * atardecer— y un objeto de módulo no puede reaccionar a eso.
   *
   * Se construye por esquema y se arman los dos una sola vez (abajo), así la identidad del objeto es
   * estable y los `useMemo` de los estilos no se recalculan de más.
   */
  export function buildTheme(scheme: 'light' | 'dark') {
    const L = semantic[scheme];
    return {
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

    /**
     * Profundidad, en las tres alturas del sistema.
     *
     * `shadowRadius` es la mitad del difuminado de CSS: iOS mide el radio de la sombra y CSS mide el
     * ancho total del degradado, así que usar el número tal cual duplicaría el desenfoque. `elevation`
     * es lo de Android, que solo entiende una altura — se aproxima con el desplazamiento.
     *
     * Sin sombra (`null`, como la altura 1 en oscuro) devuelve un objeto vacío: se puede esparcir en
     * cualquier estilo sin condicionales en el llamador.
     */
      shadow: (nivel: '1' | '2' | '3') => rnShadow(elevation[scheme][nivel]),

    radiusSm: radius.sm,
    radiusMd: radius.md,
    radiusLg: radius.lg,

    // Escala tipográfica (P1.4.3.5a, ADR-0014): roles y aliases NUMÉRICOS derivados
    // de la fuente canónica. RN usa números (los strings con `px` son solo del
    // generador web); NO se re-tipean valores acá (igual criterio que color/radio).
    // `type.*` = roles estables; `compat.*` = aliases temporales CONGELADOS (deuda).
    type: typeRole,
    compat: typeCompat,

    // Escala de SPACING (P1.4.3.6, ADR-0014-B): grid 4px + sub-unidad 2px.
    // Números (RN), derivados de la fuente canónica SIN re-tipear (igual que
    // color/radio/tipografía). Claves estilo Tailwind: `space['2']`=8, `['6']`=24…
    // Solo layout (padding/margin/gap); NO dimensiones/alturas/touch targets.
    space,
  };
}

/** Los dos temas, armados una vez. Identidad estable → los estilos memoizados no se recalculan. */
export const themes = { light: buildTheme('light'), dark: buildTheme('dark') } as const;

export type Theme = ReturnType<typeof buildTheme>;

/*
 * ACÁ VIVÍA `export const T = themes.light`, el tema estático.
 *
 * Existió para que la conversión pudiera ir por pasos: mientras duró, lo no convertido seguía
 * compilando y viéndose como siempre. Ya no queda nada que lo use, así que se va — y su ausencia es
 * lo que ahora IMPIDE volver atrás.
 *
 * Es la diferencia entre una convención y una garantía. Con `T` disponible, una pantalla nueva podía
 * importarlo, compilar perfecto y verse clara sobre fondo oscuro; el typechecker no tenía nada que
 * decir y solo un barrido manual lo encontraba. Sin `T`, esa pantalla no compila: hay que pedir el
 * tema con `useTheme()`, que es la única forma de obtenerlo.
 */
