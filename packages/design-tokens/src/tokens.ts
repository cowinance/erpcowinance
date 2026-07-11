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

/**
 * P1.4.3 (ADR-0014) — Escala tipográfica, spacing y densidad.
 *
 * TRES niveles deliberados (NO se crea un rol por cada px existente):
 *   1) fontSize   — rampa PRIMITIVA de tamaños del DS (px, número).
 *   2) typeRole   — roles SEMÁNTICOS aprobados por ADR-0014 (parte ESTABLE del DS).
 *   3) typeCompat — ALIASES TEMPORALES de compatibilidad (DEUDA; NO estable).
 *
 * En P1.4.3 los roles son SOLO tamaño: line-height, peso, tracking y color siguen
 * siendo ejes SEPARADOS (como hoy). La normalización a los line-height ideales de
 * la spec §2 es una fase POSTERIOR con aprobación explícita — no se introduce acá.
 */

/** 1) Rampa PRIMITIVA de tamaños (px). Pasos canónicos del DS. */
export const fontSize = {
  '11': 11,
  '12': 12,
  '13': 13,
  '14': 14,
  '15': 15,
  '17': 17,
  '20': 20,
  '30': 30,
  '56': 56,
} as const;

/** 2) Roles SEMÁNTICOS aprobados (ADR-0014, spec §2). API ESTABLE (`text-<rol>`
 *  en web, `T.type.<rol>` en móvil). SOLO tamaño en P1.4.3: peso, tracking,
 *  line-height y color NO se hornean acá (siguen como utilidades separadas). */
export const typeRole = {
  display: fontSize['30'], // KPI / stat grande
  title: fontSize['20'], // título de página (h1)
  heading: fontSize['17'], // encabezado de sección (h2)
  subheading: fontSize['15'], // título de card (h3)
  input: fontSize['14'], // texto de control/input
  body: fontSize['13'], // cuerpo / celda de tabla (workhorse)
  label: fontSize['12'], // etiqueta de formulario, hint
  caption: fontSize['11'], // metadato, badge, overline (tracking/caso van aparte)
  hero: fontSize['56'], // auth/marketing (tier expresivo)
} as const;

/** 3) ALIASES TEMPORALES DE COMPATIBILIDAD — DEUDA de P1.4.3 (NO parte estable
 *  del DS). Existen SOLO para preservar valores exactos actuales que no mapean a
 *  un rol aprobado (behavior-preserving). Se consumen como `text-compat-<n>` en
 *  web / `T.compat['<n>']` en móvil. Se ELIMINAN cuando se autorice la
 *  convergencia visual (normalización). Prohibido usarlos en código nuevo.
 *  Consumidores conocidos anotados por valor. */
export const typeCompat = {
  '9': 9, // web: FarmMap (etiqueta mínima de nodo)
  '10': 10, // web: badge de nav, chart axis (SVG WeightChart queda fuera de alcance)
  '16': 16, // web: 1 uso; móvil: varios títulos/labels
  '18': 18, // móvil
  '22': 22, // web/móvil: títulos intermedios
  '24': 24, // web/móvil
  '26': 26, // móvil: KPI (diverge de display=30 web; la divergencia se PRESERVA)
  '28': 28, // web
  '32': 32, // móvil
  '48': 48, // móvil
  '64': 64, // web: hero grande (auth)
} as const;

/**
 * Escala de SPACING (px, número). Grid base 4px + sub-unidad 2px (ADR-0014-B).
 * NOTA: la WEB ya consume esta misma escala vía las utilidades de Tailwind
 * (`p-3`=12, `gap-2`=8, `mt-0.5`=2, …) → en web NO se emite ni se envuelve nada.
 * Esta rampa es la FUENTE para MÓVIL (React Native no tiene escala): su
 * sustitución CLASIFICADA (layout vs. dimensión vs. óptico vs. táctil vs.
 * específico de componente) es P1.4.3.6, no automática.
 */
export const space = {
  '0': 0,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
} as const;

/**
 * Capa de DENSIDAD (ADR-0014 dec. C) — CONTRATO con UN SOLO modo activo.
 * Declara qué multiplica la densidad (alturas y aire de controles). NO se aplica
 * en P1.4.3: el cableado de estos valores a los primitivos (input/botón/fila/card)
 * se hace en P1.4.4. Desde P1.4.3 queda PROHIBIDO introducir alturas interactivas
 * nuevas hardcodeadas; los primitivos futuros deben referenciar esta capa.
 *
 * Qué NUNCA cambia con la densidad: tipografía, color y su significado, radius,
 * sombra, iconografía y los mínimos de accesibilidad (44px táctil en touch).
 */
export interface DensityMode {
  controlH: number; // alto de control (input/botón/nav-item) — hoy ≈ h-9 (36)
  rowH: number; // alto de fila de tabla/lista
  padY: number; // padding vertical de contenedores
  gap: number; // separación entre elementos de grupo
  cardPad: number; // padding de card (web hoy 20; móvil hoy 16 → se reconcilia en P1.4.4)
}

export const density: { standard: DensityMode } = {
  standard: { controlH: 36, rowH: 40, padY: 8, gap: 12, cardPad: 20 },
};
