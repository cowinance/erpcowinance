# 0015 — Densidad runtime y eje de tamaño de los primitivos

- **Estado:** aceptado
- **Fecha:** Fase Producto, P1.4 (Fundamentos de experiencia), P1.4.4.1b
- **Contexto relacionado:** [[0014-design-system-specification]] (decisión **C** — este ADR **especifica su mecanismo**, no la reemplaza), [[0013-design-tokens-single-source]] (pipeline de tokens que esto extiende), [[0006-value-object-strategy]] (YAGNI: ninguna abstracción ni modo sin consumidor/prueba real), [[0012-onboarding-initial-experience]] (divergencia deliberada web/móvil por contexto de uso). Prototipo validado: commit `f6e6d51` (P1.4.4.1a).

## Contexto

ADR-0014 **decisión C** resolvió que la densidad (cómodo / estándar / compacto) es una **capa runtime**, introducida desde P1.4.3 con **un solo modo activo**, y que los primitivos interactivos **nunca** hornean alturas/paddings verticales fijos. Dejó **abierto el mecanismo concreto** y describió la capa con la palabra "multiplicadora" — lenguaje conceptual, no una fórmula comprometida.

P1.4.4 empieza a construir los primitivos (Button primero) y necesita ese mecanismo **antes** de cablear ningún consumidor. El prototipo **P1.4.4.1a** (commit `f6e6d51`) ya validó técnicamente la parte web: emitir `--density-*` como custom properties CSS **reales** desde la fuente canónica, con `data-density` en SSR, sin flash ni hydration mismatch, sin cambio visual y sin consumidores. Este ADR fija la **decisión definitiva** del contrato y su mecanismo en ambas plataformas.

**Precisión sobre ADR-0014.** Este ADR **especifica** la decisión C; no la reescribe. En particular, refina "capa multiplicadora" a **tablas explícitas auditadas** (ver decisión 2) y adopta el prefijo `--density-*` (la nota de C listaba `--control-h`… sin prefijo) para marcar intención y evitar colisión de nombres. La intención de C —densidad como capa runtime, un modo, sin alturas horneadas, touch ≥44px— se mantiene intacta.

## Decisión

### 1. Dos ejes independientes: `size` × `density`

Se separan explícitamente dos ejes que hoy están mezclados en las alturas literales (`h-8`/`h-9`/`h-10`):

- **`size`** — variante **local del componente**: `sm` · `md` · `lg`. La elige quien usa el primitivo, por función (un botón secundario compacto vs. un CTA grande). No es global.
- **`density`** — **política global** de compactación de la interfaz: `standard` (operativo) · `compact` · `comfortable` (reservados). La define el entorno/usuario, no el componente.

No se derivan uno del otro. La altura efectiva de un control es la celda **(size, density)** de una tabla explícita, no una operación aritmética. Hoy solo existe la columna `standard`.

### 2. Tablas explícitas, sin multiplicadores

**Prohibido** expresar la densidad o el tamaño mediante un multiplicador matemático (`valor = base × 0.85`) o sumando/restando píxeles a un valor estándar. Todos los valores son **enteros, auditados y definidos deliberadamente**, preservando los valores históricos de forma explícita.

Tabla operativa **web** (modo `standard`, único con valores hoy):

| Token / eje | Valor | Origen histórico |
|---|---|---|
| `--density-control-h` (baseline = size `md`) | 36px | `h-9` |
| `--density-row-h` | 40px | fila de tabla/lista actual |
| `--density-pad-y` | 8px | padding vertical de contenedores |
| `--density-gap` | 12px | separación de grupo |
| `--density-card-pad` | 20px | padding de Card web |
| control `size=sm` | 32px | `h-8` (se modela en Button, P1.4.4.1c) |
| control `size=md` | 36px | `h-9` |
| control `size=lg` | 40px | `h-10` |

Los modos `compact` y `comfortable` **no tienen columna** todavía: sus tablas (incluidas las alturas por `size`) se definirán **solo cuando se auditen con pruebas de densidad reales**. No se generan por fórmula desde `standard`.

### 3. Web — mecanismo

- **Variables CSS reales `--density-*`** en bloques `:root` (no en `@theme inline`: Tailwind v4 *inlinea* esos tokens y no son una API runtime fiable para `var()` ni `getComputedStyle()`; verificado en el prototipo).
- **Fallback `:root` = `standard`**: aunque falte el atributo, los valores ya son los correctos.
- **Selección por `data-density`** en `<html>`; el bloque `:root[data-density='standard']` es idéntico al fallback.
- **Atributo estático en SSR** inicialmente (`<html data-density="standard">`), sin lógica de cliente → **sin hydration mismatch, sin flash**.
- **Sin selector visible** todavía; **sin Context ni estado de cliente**. Cambiar de modo en el futuro será cambiar el atributo (o su fuente), no reescribir componentes.

### 4. Móvil — mecanismo

- **Mismo contrato semántico** (mismos nombres y modos) que web, pero **valores absolutos propios**: el mínimo táctil obliga a alturas mayores (control ~44, input ~46) — **no se heredan los 36/40 de web**.
- **Consumo vía `theme.ts`** (el adaptador ya existente deriva de la fuente canónica), exponiendo una tabla de densidad numérica; **sin Context** por ahora (un solo modo).
- **Targets interactivos nunca < 44px**, aunque un modo futuro (`compact`) pida menos: el contrato **clampa** a 44 en touch.
- El **mecanismo definitivo de los componentes móviles** (cómo cada primitivo consume la tabla, quitar el `height: 44` horneado del `Button` actual) queda **diferido a P1.4.4.5**. Este ADR fija el contrato, no la implementación móvil.

### 5. Estado de soporte

- **Solo `standard` tiene valores operativos.**
- `compact` y `comfortable` son **modos reservados** (nominales): documentados como contrato futuro, **no implementados ni prometidos**. No se exponen valores inventados.
- **No debe existir una API runtime que aparente soportar modos no probados** (ni `data-density="compact"` con valores, ni tabla móvil `compact`). La densidad se activa **modo por modo, tras auditoría**.

### 6. Relación con Button (primer consumidor)

- **Button es el primer consumidor** de la capa (P1.4.4.1c) y del eje `size`.
- Las **alturas históricas 32/36/40** se modelan mediante **`size` (`sm`/`md`/`lg`)** con valores **explícitos**, no derivados.
- La **densidad no sustituye el eje de tamaño**: `size` sigue existiendo dentro de cada modo de densidad.
- La **primera migración es behavior-preserving**: mismas alturas, texto, foco, estados y árbol accesible; las divergencias históricas se representan como variantes, no se unifican en silencio.

### 7. Propiedades afectadas y excluidas

- **Puede afectar:** alturas de control, alto de fila, padding vertical/horizontal de contenedores, gaps, padding de card, densidad de formularios.
- **Nunca cambia:** tipografía y su tamaño, color y su **significado**, radius, sombra, iconografía, arquitectura de información, ni los estados semánticos.
- **Nunca reduce** los targets táctiles móviles por debajo de **44px** (el modo `compact`, cuando exista, no puede violarlo).

## Alternativas descartadas

- **Multiplicador matemático genérico** (`base × factor`): produce valores no enteros, no auditados y frágiles ante accesibilidad; oculta divergencias históricas legítimas. Rechazado a favor de tablas explícitas (dec. 2).
- **Tailwind `h-*` como única estrategia**: no modela densidad global en runtime; reintroduce alturas horneadas — exactamente lo que ADR-0014 C prohíbe.
- **Props de `size` como sustituto de la densidad**: confunde una variante local con una política global; no permite recompactar toda la UI de una vez. `size` y `density` coexisten, no se sustituyen.
- **Context móvil (o web) prematuro**: con un solo modo operativo, un Context añade re-render y complejidad sin beneficio. Diferido hasta que exista un segundo modo real.
- **Valores absolutos compartidos entre web y móvil**: rompería el mínimo táctil de 44px en móvil (36 de web es inseguro al tacto). Se comparte **contrato**, no valores.

## Consecuencias

**Ventajas.** La densidad queda habilitada **sin re-arquitectura** (los primitivos referencian la capa desde el día uno); size y density dejan de estar mezclados en literales; los valores son auditables uno a uno; el prototipo demostró SSR/hydration limpios y cero flash; agregar un modo futuro es auditar una tabla y activarla, no reescribir componentes.

**Costos / limitaciones.**
- **Mantener tablas explícitas por plataforma y por modo** es más verboso que una fórmula — es el costo deliberado de la corrección y la accesibilidad.
- Cada modo (`compact`, `comfortable`) **debe auditarse antes de activarse** (contraste no cambia, pero sí ergonomía y touch); no hay atajo por multiplicación.
- **Compatibilidad SSR/hydration**: exige que la selección de densidad sea determinista en el render de servidor (hoy, atributo estático); cualquier selección dinámica futura necesitará evitar el mismatch (script inline o cookie leída en el server), análogo al anti-FOUC de `data-theme` (ADR-0014 D).
- **Deuda futura registrada:** (a) **selector de densidad** visible + persistencia de la preferencia; (b) **tablas completas** de `compact`/`comfortable` (web y móvil) tras auditoría; (c) **mecanismo móvil** de consumo por componente (P1.4.4.5); (d) posible **matriz (size × density)** por primitivo cuando haya más de un modo.

**Alcance de este ADR.** Fija el contrato de dos ejes, el mecanismo web (ya prototipado) y el contrato móvil. **No** construye Button (P1.4.4.1c), **no** migra consumidores, **no** define valores de modos no operativos. La API concreta de cada primitivo sigue siendo P1.4.4+.
