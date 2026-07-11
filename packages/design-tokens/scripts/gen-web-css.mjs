// Generador del artefacto CSS de tokens para la web (P1.4.1, ADR-0013).
// Lee la fuente canónica compilada (dist/tokens.js) y emite el CSS que consume
// apps/web/src/app/globals.css. Es TOOLING (usa Node/fs); el paquete de tokens
// en sí es neutral. Determinista: sin timestamps ni datos de entorno; orden
// estable; termina en newline. Modos:
//   node gen-web-css.mjs           → escribe el artefacto
//   node gen-web-css.mjs --check   → compara contra el commiteado y falla si difiere (no escribe)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const TARGET = resolve(REPO_ROOT, 'apps/web/src/app/tokens.generated.css');
const DIST = resolve(__dirname, '../dist/tokens.js');

const require = createRequire(import.meta.url);
const { primitive, semantic, radius, font, typeRole, typeCompat, density, isRef } = require(DIST);

const cssValue = (v) => (isRef(v) ? `var(--${v.$ref})` : v);

/** `--nombre: valor;` con 2 espacios de sangría. */
const decl = (name, value) => `  --${name}: ${cssValue(value)};`;

/** Declaraciones de un modo de densidad como custom properties `--density-*`
 *  (px), en orden ESTABLE y explícito. NO entran en @theme: son variables planas
 *  que los primitivos leen con `var(--density-…)`; no se generan utilidades
 *  especulativas sin consumidor. Alturas de control POR TAMAÑO (sm/md/lg) +
 *  alias `--density-control-h` (= md, compatibilidad) + métricas de contenedor. */
const densityDecls = (mode) => [
  `  --density-control-h-sm: ${mode.control.sm}px;`,
  `  --density-control-h-md: ${mode.control.md}px;`,
  `  --density-control-h-lg: ${mode.control.lg}px;`,
  `  --density-control-h: ${mode.control.md}px;`,
  `  --density-row-h: ${mode.rowH}px;`,
  `  --density-pad-y: ${mode.padY}px;`,
  `  --density-gap: ${mode.gap}px;`,
  `  --density-card-pad: ${mode.cardPad}px;`,
];

/** Declaraciones semánticas de un tema, en orden estable. */
function themeDecls(t) {
  return [
    decl('bg-canvas', t.bg.canvas),
    decl('bg-surface', t.bg.surface),
    decl('bg-sunken', t.bg.sunken),
    decl('bg-raised', t.bg.raised),
    decl('border-subtle', t.border.subtle),
    decl('border-strong', t.border.strong),
    decl('text-primary', t.text.primary),
    decl('text-secondary', t.text.secondary),
    decl('text-tertiary', t.text.tertiary),
    decl('success', t.status.success),
    decl('warning', t.status.warning),
    decl('danger', t.status.danger),
    decl('info', t.status.info),
    decl('accent', t.accent),
    decl('accent-soft', t.accentSoft),
    decl('shadow-1', t.shadow['1']),
    decl('shadow-2', t.shadow['2']),
    decl('shadow-3', t.shadow['3']),
  ];
}

function buildCss() {
  const L = semantic.light;
  const lines = [];
  lines.push('/* GENERADO por @cowinance/design-tokens — NO EDITAR A MANO.');
  lines.push('   Fuente: packages/design-tokens/src/tokens.ts · regenerar: npm run tokens:build */');
  lines.push('');
  // :root — primitivos + semánticos claros
  lines.push(':root {');
  lines.push('  /* Marca (primitivos) */');
  lines.push(decl('brand-900', primitive.brand['900']));
  lines.push(decl('brand-700', primitive.brand['700']));
  lines.push(decl('brand-500', primitive.brand['500']));
  lines.push(decl('brand-300', primitive.brand['300']));
  lines.push(decl('brand-100', primitive.brand['100']));
  lines.push(decl('amber-500', primitive.amber['500']));
  lines.push('  /* Semánticos — modo claro */');
  lines.push(...themeDecls(L));
  lines.push('}');
  lines.push('');
  // Dark — overrides semánticos (los primitivos no cambian)
  lines.push('@media (prefers-color-scheme: dark) {');
  lines.push('  :root {');
  lines.push(...themeDecls(semantic.dark).map((l) => '  ' + l));
  lines.push('  }');
  lines.push('}');
  lines.push('');
  // Densidad (ADR-0015, especifica ADR-0014 dec. C) — UN solo modo operativo:
  // `standard`, con tabla EXPLÍCITA y auditada (sin multiplicador ni derivar un
  // tamaño de otro). El eje `size` del primitivo mapea a `--density-control-h-{sm,
  // md,lg}` (32/36/40 = h-8/h-9/h-10); `--density-control-h` es alias de `md`. El
  // fallback en :root ES `standard` → sin atributo `data-density` los valores ya
  // son correctos: no hay flash ni hydration mismatch. `compact`/`comfortable` son
  // NOMINALES: no se emiten valores hasta que existan pruebas de densidad reales.
  lines.push('/* Densidad (ADR-0015) — modo único operativo: standard; alturas de control por tamaño. */');
  lines.push(':root {');
  lines.push(...densityDecls(density.standard));
  lines.push('}');
  lines.push('');
  lines.push(":root[data-density='standard'] {");
  lines.push(...densityDecls(density.standard));
  lines.push('}');
  lines.push('');
  // @theme inline — mapeo semántico → utilidades Tailwind (nombres fijos)
  lines.push('@theme inline {');
  const theme = [
    ['color-canvas', 'var(--bg-canvas)'],
    ['color-surface', 'var(--bg-surface)'],
    ['color-sunken', 'var(--bg-sunken)'],
    ['color-raised', 'var(--bg-raised)'],
    ['color-subtle', 'var(--border-subtle)'],
    ['color-strong', 'var(--border-strong)'],
    ['color-ink', 'var(--text-primary)'],
    ['color-ink-2', 'var(--text-secondary)'],
    ['color-ink-3', 'var(--text-tertiary)'],
    ['color-brand', 'var(--accent)'],
    ['color-brand-soft', 'var(--accent-soft)'],
    ['color-brand-300', 'var(--brand-300)'],
    ['color-amber', 'var(--amber-500)'],
    ['color-success', 'var(--success)'],
    ['color-warning', 'var(--warning)'],
    ['color-danger', 'var(--danger)'],
    ['color-info', 'var(--info)'],
    ['radius-sm', `${radius.sm}px`],
    ['radius-md', `${radius.md}px`],
    ['radius-lg', `${radius.lg}px`],
    ['font-sans', font.sans],
    ['font-mono', font.mono],
  ];
  // Escala tipográfica — roles semánticos ESTABLES (ADR-0014). Solo tamaño:
  // line-height/peso/tracking siguen siendo ejes separados en P1.4.3.
  // (Spacing NO se emite: la web ya consume la escala de Tailwind. Densidad
  //  tampoco: se define en la fuente y se aplica en P1.4.4.)
  for (const [name, size] of Object.entries(typeRole)) theme.push([`text-${name}`, `${size}px`]);
  // Aliases TEMPORALES de compatibilidad (DEUDA P1.4.3; se eliminan al converger).
  for (const [n, size] of Object.entries(typeCompat)) theme.push([`text-compat-${n}`, `${size}px`]);
  for (const [name, value] of theme) lines.push(`  --${name}: ${value};`);
  lines.push('}');
  lines.push(''); // termina en newline
  return lines.join('\n');
}

const css = buildCss();
const check = process.argv.includes('--check');

if (check) {
  let current = null;
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    /* no existe */
  }
  if (current !== css) {
    console.error(
      `✗ tokens:check — ${TARGET.replace(REPO_ROOT + '/', '')} está desactualizado o editado a mano.\n` +
        '  Regenerá con: npm run tokens:build  (NO se corrige automáticamente en el gate).',
    );
    process.exit(1);
  }
  console.log('✓ tokens:check — el artefacto CSS de la web coincide con la fuente canónica.');
} else {
  writeFileSync(TARGET, css);
  console.log(`✓ tokens:build — escrito ${TARGET.replace(REPO_ROOT + '/', '')}`);
}
