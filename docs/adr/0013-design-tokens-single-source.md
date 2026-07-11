# 0013 — Design System: fuente única de tokens (neutral + generación)

- **Estado:** aceptado
- **Fecha:** Fase Producto, P1.4 (Fundamentos de experiencia), P1.4.1
- **Contexto relacionado:** [[0004-domain-package]] (patrón de paquete de workspace puro que se replica), [[0012-onboarding-initial-experience]] (P1.3 construyó pantallas sobre el diseño existente, sin sistema formal); `docs/product/*`

## Contexto

Los tokens de diseño estaban **duplicados a mano** en dos formatos: `apps/web/src/app/globals.css`
(CSS vars + `@theme` de Tailwind v4) y `apps/mobile/src/theme.ts` (objeto TS para React Native). Los
mismos hex se mantenían en paralelo → cualquier cambio de marca se hacía dos veces y derivaban. P1.4
(sistema de diseño) no puede avanzar sobre esa base.

Restricción técnica decisiva: **Tailwind v4 es CSS-first** — necesita los tokens como **CSS en
build-time** (`@theme`) para generar utilidades (`bg-brand`, `text-ink-2`…). **No** puede importar un
objeto TS. El móvil, en cambio, quiere un **objeto JS**. Son dos formatos de consumo incompatibles: una
sola fuente debe **alimentar ambos**, no ser importada igual por los dos.

Verificado antes de decidir: la web consume cero paquetes del workspace hoy; el móvil ya consume
`@cowinance/domain`/`sync-core` desde su `dist` compilado (resolución por defecto de Metro). Un
**prototipo** confirmó que `@theme inline` **funciona desde un CSS importado** (`@import` de un artefacto
generado), no hace falta inyectarlo inline en `globals.css`.

## Decisión

**Una fuente neutral única en TS; el móvil la consume directo; la web consume un CSS generado; con
generador propio mínimo y un gate anti-deriva.** El criterio no es "cero hex duplicados en artefactos
finales" sino **una sola fuente editable**: CSS/TS secundarios pueden contener valores derivados, nunca
mantenidos a mano en paralelo.

### A. Fuente canónica: `@cowinance/design-tokens`
`packages/design-tokens/src/tokens.ts` es la **única verdad editable**. Paquete **neutral** (sin
React/Next/Expo/Node/DOM; el `tsconfig` lo fuerza con `lib:ES2022` + `types:[]`, como el dominio puro de
ADR-0004). Distingue **primitivos** (rampas de color) de **semánticos** (fondo/superficie/texto/estado/
acento por tema claro/oscuro); `accent`/`accentSoft` son **referencias** a primitivos para preservar
`var(--brand-700)` y el cascade de dark. Compila a `dist` (CJS, `main`/`types`) como los demás paquetes.

### B. Móvil: consumo directo mediante adaptador
`apps/mobile/src/theme.ts` **deriva** `T` de la fuente (tema claro) **sin re-tipear** hex/radios. Preserva
la API `T.*` → los ~15 consumidores no se tocan. No hay un segundo archivo de valores para móvil.

### C. Web: CSS generado importado
`packages/design-tokens/scripts/gen-web-css.mjs` (tooling Node) deriva
`apps/web/src/app/tokens.generated.css` desde la fuente; `globals.css` lo `@import`a y deja de definir
tokens a mano. El artefacto es **determinista** (sin timestamps/datos de entorno, orden estable, termina
en newline, igual en macOS/Linux) y lleva cabecera **"generado, no editar"**.

### D. Generador propio mínimo (no Style Dictionary)
~40 tokens y 2 targets no justifican una dependencia + config; se usa un script propio (estilo
`scripts/audit-arch.mjs`). Style Dictionary queda como escape si aparecen targets nativos iOS/Android o
más formatos.

### E. Validación anti-deriva: `tokens:build` vs `tokens:check`
- **`tokens:build`** construye el paquete y **escribe** el artefacto (regeneración explícita).
- **`tokens:check`** construye y **compara** contra lo commiteado; **falla** ante deriva **sin modificar
  archivos** (nunca autocorrige). Es Gate 0 de `audit:arch` (corre primero: su build deja el `dist` que
  necesita el typecheck de mobile). Se prefiere `tokens:check` en gates; la regeneración es manual con
  `tokens:build`.

## Consecuencias

**Ventajas:** una sola verdad editable; artefactos derivados, no paralelos; consistencia web↔móvil
garantizada; base para P1.4.2+ (escala tipográfica, densidad, dark) sin re-arquitectura.
**Costos/limitaciones:** un paso de build (`tokens:build`) al cambiar tokens; DX de "regenerar y
commitear" el CSS (mitigado por el gate); el paquete debe estar compilado para el typecheck de mobile
(igual que domain/sync-core). Sin watcher de dev por ahora (para no ensuciar el árbol ni ocultar deriva).

## Alternativas consideradas

- **Import directo del objeto TS en ambas apps:** descartado — **inviable para la web** con Tailwind v4
  (necesita CSS en build-time; mantener el CSS a mano = deriva).
- **CSS como fuente + generar TS:** descartado — CSS es peor fuente (sin tipos ni comentarios).
- **Style Dictionary:** descartado por ahora — prematuro para ~40 tokens / 2 targets (YAGNI).
- **Inyección entre marcadores en `globals.css`:** innecesaria — el prototipo confirmó que `@theme`
  funciona desde un CSS importado (queda como plan B documentado).

## Fuera de alcance (P1.4.2+)

Escala tipográfica, escala de spacing, modos de densidad (cómodo/estándar/compacto), decisión de dark
mode, contrato de iconografía, y todos los componentes/primitivos. P1.4.1 es **estrictamente
behavior-preserving**: mismos valores visuales, solo relocalizados. La especificación del sistema será su
propio ADR tras P1.4.2.
