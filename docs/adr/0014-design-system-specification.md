# 0014 — Design System: escala tipográfica, spacing, densidad, dark mode, iconografía y accesibilidad

- **Estado:** aceptado
- **Fecha:** Fase Producto, P1.4 (Fundamentos de experiencia), P1.4.2
- **Contexto relacionado:** [[0013-design-tokens-single-source]] (pipeline de tokens que esta spec extiende), [[0012-onboarding-initial-experience]] (divergencia deliberada web/móvil por contexto), [[0004-domain-package]] + [[0006-value-object-strategy]] (rigor YAGNI: ninguna abstracción sin consumidor real); spec completa en `docs/design-system/P1.4.2-design-system-spec.md`; `docs/product/*`, `docs/Cowinance_Design_System.docx`.

## Contexto

ADR-0013 dejó la **fuente única de tokens** (color/radio/sombra/fuente) pero declaró explícitamente fuera de alcance el resto del sistema: escala tipográfica, spacing, densidad, dark mode, iconografía y primitivos. Ese "resto" vive hoy como **números mágicos dispersos**, verificado por auditoría del código:

- **18 tamaños tipográficos** distintos `text-[Npx]` en web, sin nombres; workhorse 13px (**103 usos**), 12px (83), 11px (33). Line-height casi no controlado; 4 pesos en uso.
- **Divergencias accidentales** web/móvil: KPI 30px vs 26px, padding de Card 20 vs 16, y la web **sin** primitivo `Button` (el móvil sí).
- **Dark mode por accidente**: la web sigue `@media (prefers-color-scheme)` heredado con contrastes **sin auditar**; el móvil es solo claro. Estado inconsistente y no decidido.
- **Dos librerías de iconos** (lucide web + Ionicons móvil) sin contrato de significado/tamaño/estado.
- **Gap de navegación**: bajo el breakpoint `lg` la sidebar web desaparece **sin reemplazo**.
- **Sin densidad** (cómodo/estándar/compacto), que un ERP agropecuario necesita.

P1.4.2 es **exclusivamente conceptual** (no toca pantallas/componentes/CSS/tokens). Su entregable es la especificación aprobada; este ADR registra las **decisiones de arquitectura** que de ella se derivan y que gobernarán todo el frontend futuro. El detalle de valores (tamaños, peldaños, duraciones) vive en la spec, no acá — puede cambiar sin ADR.

Principio rector heredado y confirmado: **no se reinventa el look de Cowinance — se sistematiza y fortalece**. Todo es behavior-preserving en intención: nombrar y ordenar lo existente, resolver divergencias accidentales, dejar contratos para lo que aún no existe.

## Decisión

Se adoptan siete decisiones de arquitectura (A–G). Cada una extiende el pipeline de ADR-0013 (fuente TS neutral → CSS web generado + adaptador móvil), sin re-arquitectura.

### A. La API tipográfica son roles semánticos, no tamaños sueltos
La escala se expone como **tokens/roles semánticos `type-*`** (`type-body`, `type-label`, `type-heading`…), no como utilidades de tamaño arbitrario. Un desarrollador elige un **rol** (por función), nunca un `text-[22px]`. Los roles viven en la fuente canónica y se derivan a ambos targets. Utilidades Tailwind sueltas solo como escape puntual. Motivo: cierra la puerta a que reaparezcan los 18 magic numbers; hace la jerarquía explícita y auditable.

### B. Grid base de spacing: 4px con sub-unidad documentada de 2px
La unidad de layout es **4px**; se admite una **sub-unidad de 2px acotada a detalle óptico** (insets, badges, separación icono-texto), no a layout. La escala de spacing completa (0–64) es token. Motivo: coincide con el uso real del código (que ya usa medios pasos), sin rediseñar lo existente ni pretender un 4px puro que rompería los `*-0.5`/`*-2.5` actuales.

### C. La densidad es una capa multiplicadora en runtime, introducida desde P1.4.3
Los modos **cómodo / estándar / compacto** se modelan como una **capa de tokens que multiplica spacing y alturas** (`--control-h`, `--row-h`, `--pad-y`, `--gap`, `--card-pad`), resuelta en runtime vía `data-density` (web) / objeto de tema derivado (móvil). **Qué cambia:** aire y alturas. **Qué NUNCA cambia:** la escala tipográfica, los tokens de color y su significado, el radius/sombra/iconografía, la arquitectura de información, y los mínimos de accesibilidad (foco, contraste, **44px de target táctil en touch, siempre** — compacto no puede violarlo). La capa se introduce **desde P1.4.3 aunque con un solo modo activo**: los primitivos interactivos referencian la capa (`var(--control-h)`), **nunca** alturas/paddings verticales fijos. Motivo: si los primitivos hornean alturas (como hoy), agregar modos después obliga a reescribirlos — es la decisión de mayor costo si se difiere.

### D. Dark mode: web controlado y auditado; móvil claro-primero, dark diferido
- **Web:** se soporta dark, pero se **migra de accidente a decisión**: de `@media (prefers-color-scheme)` **automático** a **controlado por usuario** (`data-theme="light|dark"`, default claro, SO como pista inicial), y se vuelve un **target auditado** (contraste AA en dark + screenshots dirigidos). Se pule en P1.4.7, sobre un sistema ya cerrado (se audita dark una sola vez).
- **Móvil:** **claro primero, dark diferido**. El contexto de campo (sol directo, donde el claro se lee mejor) hace del claro la prioridad; los tokens dark **se conservan** en la fuente pero **no se cablean** hasta que haya demanda real + prueba de campo.

Motivo: el estado actual es inconsistente y no intencional; un dark automático es disruptivo en trabajo de datos, y un dark móvil a medias es peor que no tenerlo. La divergencia web-dark/móvil-claro es **justificada por contexto**, coherente con ADR-0012 (oficina ≠ campo). Consecuencia técnica: cambia la generación del CSS de tokens (media-query como default + override por `[data-theme]`) y exige un script inline anti-FOUC en Next.

### E. Iconografía: contrato de significado, dos librerías permitidas
El contrato es un **mapa semántico compartido** (concepto → icono lucide + icono Ionicons) más reglas de **forma** (ladder de tamaños anclado al texto 14/16/18/20/24/28–32, trazo 1.75, outline-primero, `currentColor`, estados por token) y de **accesibilidad** (decorativo → `aria-hidden`; interactivo → `aria-label` + 44px). **Se permiten dos librerías** (lucide web + Ionicons móvil): un concepto = un icono visualmente equivalente en ambas. **No** se elige vendor único (YAGNI): el contrato es el significado, no el proveedor.

### F. Estándar de accesibilidad: WCAG 2.1 AA como piso de aceptación
AA es **piso**, no aspiración: contraste (4.5:1 texto / 3:1 grande y UI), foco siempre visible (nunca `outline:none` sin reemplazo), operación completa por teclado, **44×44px de target táctil en touch**, screen readers (HTML semántico, `aria-label` en botones solo-icono, live regions para sync/guardado), formularios con label asociado y error no-solo-color, **estado nunca solo por color** (color + icono + texto), y respeto de `prefers-reduced-motion`. Contrastes de `text-tertiary` y estados se auditan en claro **y** dark antes de declararlos oficiales.

### G. Breakpoints y resolución del gap de navegación web
Breakpoints `xs<480 · sm 480 · md 768 · lg 1024 · xl 1440` (alineados al `lg` que ya corta la sidebar). Bajo `lg`, la sidebar **colapsa a top bar + drawer** (mismo `SECTIONS`), cerrando el gap actual. Reparto de responsabilidad (ADR-0012): la **app nativa** es dueña del móvil real; la **web** cubre desktop/tablet con calidad y degrada con dignidad (móvil-web como fallback, no como clon de la app).

## Consecuencias

**Ventajas:** una escala nombrada elimina 18 magic numbers; el ritmo espacial se vuelve predecible; la densidad queda habilitada **sin re-arquitectura** (si se respeta C); el dark deja de ser un accidente no auditado; dos plataformas de iconos hablan el mismo idioma; AA es contractual; la navegación web deja de romperse bajo `lg`. Todo extiende el pipeline ADR-0013 sin dependencias nuevas.

**Costos/limitaciones:** extender el generador para emitir tipografía/spacing/densidad a ambos targets (número para RN, `px` para web); `tokens:build` obligatorio tras cada cambio; QA visual crece con dark × densidad (mitigado con snapshots dirigidos, no matriz completa; dark auditado una sola vez al final); riesgo de retrabajo **alto** si la capa de densidad (C) se difiere; script anti-FOUC en Next para `data-theme`; posible ajuste de `type-input` a ≥16px en campos móviles críticos (auto-zoom iOS).

## Alternativas consideradas

- **Utilidades de tamaño sueltas (`text-*` de Tailwind) como API principal** (rechazada, dec. A): reabre la puerta a los magic numbers; el rol semántico hace la jerarquía explícita.
- **Grid 4px puro sin sub-unidad** (rechazada, dec. B): rompería/rediseñaría los medios pasos ya usados; el 2px acotado a detalle es fiel al código real.
- **Densidad horneada por componente / diferida a "cuando se pida"** (rechazada, dec. C): imposibilita agregar modos luego sin reescribir primitivos; introducir la capa desde P1.4.3 (aunque con un modo) es el corte barato.
- **Dark mode automático por `@media` (statu quo) o dark móvil ya** (rechazadas, dec. D): el automático es disruptivo y hoy no está auditado; el dark móvil no aporta en campo y duplica QA/lógica RN sin retorno.
- **Elegir una única librería de iconos cross-platform ahora** (rechazada, dec. E): prematuro (YAGNI); dos librerías con un contrato de significado alcanzan. Queda como escape si aparece un target que lo exija.
- **AAA como estándar** (rechazada, dec. F): AA es el piso correcto y alcanzable de forma consistente; exigir AAA global sería especulativo y a menudo incompatible con la densidad ERP.

## Fuera de alcance (evolución natural, no bloquea P1.4)

Ampliaciones que crecerán cuando sus módulos entren en desarrollo, sin bloquear esta fase: componentes de **tablas empresariales** avanzadas (virtualización, edición en celda), **dashboards** analíticos, **formularios complejos** multi-paso, **internacionalización visual** (RTL, densidad por idioma, formato regional más allá de la presentación por TZ ya pendiente) y **componentes para IA** (asistentes, sugerencias). También queda fuera: la **API concreta** de cada primitivo (P1.4.4+), el **mapa exacto** concepto→icono (tabla viva de P1.4.4/P1.4.6), los **valores** de tipografía/spacing/motion (spec + `tokens.ts`, cambian sin ADR), y la elección de **vendor único** de iconos (revisable).

## Nota de implementación — P1.4.3 (aplicación de la escala, cerrada)

P1.4.3 aplicó las decisiones A/B/C a la escala tipográfica y de spacing (web + móvil), **behavior-preserving** (mismos valores visuales; solo se relocalizaron a tokens). No se implementaron dark (D), iconografía (E), primitivos ni responsive (G) — eso es P1.4.4+. Detalle de secuencia y verificación: `docs/handoff/session-handoff-2026-07-10.md`.

**Cómo se aplicó la decisión A (roles = solo tamaño).** Los roles `type-*` se migraron mapeando **1:1 al valor de tamaño actual**, sin introducir los line-height ideales de la spec §2: en Tailwind v4, `@theme --text-<rol>` sin companion de line-height compila a `font-size` solamente (verificado en el piloto). Peso, tracking y color siguen siendo utilidades separadas. **La normalización a los line-height de la spec §2 es una fase futura visible, con aprobación explícita** — no se hizo acá.

**Excepciones reales que emergieron (deuda registrada, no ocultada).** Behavior-preserving obligó a dejar literales varios usos que no encajan honestamente en un rol; se documentan como deuda para una futura **convergencia/normalización visible**, no se fingen inexistentes:
- **Web:** `text-xl` (named Tailwind con line-height propio; migrar cambiaría el line-height); `fontSize` de SVG en `FarmMap`/`WeightChart` (atributos de presentación, no clases); `text-[14px]` de encabezados en reportes/alertas (contenido no-control, no rol input); base raíz `<body> text-[14px]` de `layout.tsx`; **manga** (`app/manga/page.tsx`) como superficie **bespoke de alta visibilidad de campo**; página placeholder de **módulos no implementados** (`app/modulo/[slug]`). Colores hex de manga (`#4ade80`/`#f87171`) fuera de alcance de P1.4.3 (no es color).
- **Móvil:** identificadores mono de **caravana** (12/15/16/32 px — dato de dominio, no rol); **contenido de 14 px** (filas/valores/cuenta, no controles → no rol input); **inputs históricos de 15 px** (no encajan en input=14 ni subheading); **logo** del login (marca decorativa); **manga** (`app/manga.tsx`) bespoke. En spacing: `7 px` óptico de una fila de Sync y `14 px` (un gap + dos paddingHorizontal) quedan literales; **no se creó `space['3.5']`**.

**Escala de spacing.** Se corrigió una omisión: se agregó `space['2.5'] = 10` (paso 2.5 de Tailwind, 9 consumidores reales) en un commit de fuente independiente. El resto de la escala (§3) quedó estable. El móvil consume `T.space['<k>']` (números); la web sigue usando Tailwind (la escala no se emite a web).

**Aliases de compatibilidad (`typeCompat`).** El set se **congeló** durante toda la migración. Al cierre de P1.4.3 había **7 aliases con consumidores** (compat-9/10/16/22/24/26/28) y **4 sin consumidores** (compat-18/32/48/64). Los 4 sin uso se **podaron en el capítulo de consolidación de P1.4.4** (cero usos web + móvil, verificado por grep) — ver `docs/design-system/primitives.md`. Quedan los **7 aliases con consumidores**; siguen siendo **deuda de migración, no API pública** para código nuevo, y se eliminarán al autorizar la convergencia visual.

**Densidad (decisión C).** El contrato `density` (un modo `standard`: controlH 36, rowH 40, padY 8, gap 12, cardPad 20) está **definido en la fuente pero NO aplicado** ni emitido a ningún artefacto consumido. Su cableado a los primitivos es P1.4.4. Regla vigente desde P1.4.3: **prohibido introducir alturas interactivas hardcodeadas nuevas** — las existentes (`h-9` web, `height: 44` móvil, etc.) se preservaron literales, no se agregó ninguna. El **mecanismo** de esta capa (dos ejes `size`×`density`, tablas explícitas sin multiplicador, `--density-*` en web, tabla propia móvil con touch ≥44px) se especifica en [[0015-density-runtime-primitive-size-axis]] (P1.4.4); su prototipo web es el commit `f6e6d51`.
