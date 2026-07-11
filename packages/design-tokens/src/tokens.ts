/**
 * Cowinance — fuente ÚNICA y editable de tokens de diseño (P1.4.1, ADR-0013).
 *
 * Neutral: sin React/Next/Expo/Node/DOM (el tsconfig lo fuerza con `lib:ES2022`
 * + `types:[]`). Los valores viven acá UNA sola vez; los artefactos por plataforma
 * se DERIVAN de este archivo, no se mantienen en paralelo:
 *   - Web: `apps/web/src/app/tokens.generated.css` (generado; ver scripts/gen-web-css.mjs).
 *   - Móvil: `apps/mobile/src/theme.ts` (adaptador que reexporta `T` sin re-tipear valores).
 *
 * P1.4.1 es behavior-preserving: mismos valores que hoy, solo relocalizados.
 * NO se introducen escala tipográfica, spacing, densidad, dark nuevo ni renames.
 */

/** Marca de referencia a otro token (p. ej. accent → primitivo brand). El
 *  generador web la emite como `var(--<name>)`; preserva el cascade de dark. */
export interface TokenRef {
  $ref: string;
}
export const ref = (name: string): TokenRef => ({ $ref: name });
export const isRef = (v: unknown): v is TokenRef =>
  typeof v === 'object' && v !== null && '$ref' in v;

/** Tokens PRIMITIVOS: rampas crudas de color. No cambian por tema. */
export const primitive = {
  brand: {
    '900': '#0e2a20',
    '700': '#1f4e3d',
    '500': '#2e7d5b',
    '300': '#7fbfa3',
    '100': '#e7f2ec',
  },
  amber: {
    '500': '#d97b2b',
  },
} as const;

/** Un tema semántico (fondo, superficie, texto, estados, acento, sombra). */
export interface SemanticTheme {
  bg: { canvas: string; surface: string; sunken: string; raised: string };
  border: { subtle: string; strong: string };
  text: { primary: string; secondary: string; tertiary: string };
  status: { success: string; warning: string; danger: string; info: string };
  accent: string | TokenRef;
  accentSoft: string | TokenRef;
  shadow: { '1': string; '2': string; '3': string };
}

/** Tokens SEMÁNTICOS por tema. `light` es el tema soportado hoy; `dark` queda
 *  definido (como hasta ahora en CSS) pero su soporte es decisión de P1.4.2. */
export const semantic: { light: SemanticTheme; dark: SemanticTheme } = {
  light: {
    bg: { canvas: '#fafaf7', surface: '#ffffff', sunken: '#f2f2ed', raised: '#ffffff' },
    border: { subtle: '#e8e8e2', strong: '#d1d1c9' },
    text: { primary: '#191c1a', secondary: '#5a605c', tertiary: '#8b918d' },
    status: { success: '#1e7f4f', warning: '#b45309', danger: '#b3261e', info: '#20618a' },
    accent: ref('brand-700'),
    accentSoft: ref('brand-100'),
    shadow: {
      '1': '0 1px 2px rgba(0, 0, 0, 0.06)',
      '2': '0 4px 12px rgba(0, 0, 0, 0.1)',
      '3': '0 12px 32px rgba(0, 0, 0, 0.16)',
    },
  },
  dark: {
    bg: { canvas: '#0c0f0e', surface: '#151917', sunken: '#10130f', raised: '#1d2220' },
    border: { subtle: '#262b29', strong: '#343a37' },
    text: { primary: '#ecefed', secondary: '#9ba39e', tertiary: '#6a716d' },
    status: { success: '#34b375', warning: '#e8a33d', danger: '#e5534b', info: '#5ba3d0' },
    accent: ref('brand-500'),
    accentSoft: 'rgba(46, 125, 91, 0.16)',
    shadow: { '1': 'none', '2': '0 4px 12px rgba(0, 0, 0, 0.4)', '3': '0 12px 32px rgba(0, 0, 0, 0.5)' },
  },
};

/** Radios (px como número; web añade `px`, móvil usa el número). */
export const radius = { sm: 6, md: 10, lg: 16 } as const;

/** Familias tipográficas (NO es la escala tipográfica — eso es P1.4.2/P1.4.3). */
export const font = {
  sans: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  mono: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
} as const;
