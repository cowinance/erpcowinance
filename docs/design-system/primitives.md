# Primitivos del Design System (web) — patrón aprobado

> Doc vivo de P1.4.4. Registra el **patrón aprobado** de los primitivos web, su API
> y las divergencias pendientes. El mecanismo de densidad y el eje de tamaño están
> en [ADR-0015](../adr/0015-density-runtime-primitive-size-axis.md); la spec del
> sistema en [P1.4.2-design-system-spec.md](P1.4.2-design-system-spec.md).
>
> Estado: **Button** (primary/secondary en `lg` y `md`) e **Input/Select/Field**
> (`lg`/`md`/`sm` validados) aprobados y **aplicados** a auth, alta de animal,
> Sanidad, Reproducción, AddProductForm, AnimalPicker, Reportes y HealthPlans. Los
> `inputCls`/`labelCls` compartidos de captura y el `inputCls` de AuthShell fueron
> eliminados; se podaron 4 aliases `typeCompat` sin consumidores (18/32/48/64).
> **Pendiente (P1.4.4.7+):** botones con icono/estado, `sm` de Button, icon-only,
> danger, toggles, spinner de carga; y los inputs residuales (WeighingForm, búsquedas).

## Principio

Los primitivos son **presentación + estado de interacción**. No conocen dominio,
router, fetch, sesión, RLS, catálogos ni copy de negocio. Un componente de producto
compone primitivos y sí conoce el caso de uso.

## Eje de tamaño y densidad

Dos ejes **independientes** (ADR-0015):

- **`size` / `controlSize`** — variante local del componente: `sm` · `md` · `lg`.
- **`density`** — política global (`standard` operativo; `compact`/`comfortable`
  reservados, sin valores todavía).

Las alturas de control salen de la capa de densidad, **por tamaño**, con valores
explícitos (sin fórmula): en `standard`, `--density-control-h-sm|md|lg` = **32/36/40**.
En **web**, Button e Input/Select comparten esos tres valores porque el inventario
real lo confirma; **móvil tendrá su propia tabla** (touch ≥ 44px) en un capítulo futuro.

## Button — `components/Button.tsx`

```ts
variant?: 'primary' | 'secondary';   // default 'primary'
size?: 'sm' | 'md' | 'lg';           // default 'md'  (32/36/40)
loading?: boolean;                   // → aria-busy + bloquea interacción
fullWidth?: boolean;                 // default false
// + ButtonHTMLAttributes (type default 'button')
```
- `loading` no cambia el copy: el consumidor sigue controlando el texto (“Guardando…”).
- Foco visible por teclado (`focus-visible`). `disabled = disabled || loading`.
- Variantes diferidas (sin consumidores aún): `ghost`, `danger`, `icon`, `link`,
  `toggle` — se evaluarán en P1.4.4.7 (botones con icono/estado).

## Input / Select — `components/Input.tsx`, `components/Select.tsx`

```ts
controlSize?: 'sm' | 'md' | 'lg';    // default 'md'  (32/36/40)
invalid?: boolean;                   // → aria-invalid + borde de error
fullWidth?: boolean;                 // default TRUE  (ancho dominante de formularios)
// + Input/SelectHTMLAttributes (incl. size nativo, aria-*, ref)
```
- La prop se llama **`controlSize`** (no `size`) para **no colisionar** con el
  atributo HTML nativo `size`, que queda disponible.
- **`fullWidth` es `true` por defecto**; los filtros compactos usarán `fullWidth={false}`.
- Un `aria-invalid` explícito del consumidor se respeta si `invalid` es falso.
- Cáscara compartida en `components/controlStyles.ts` (fuente única; foco `focus:`
  para preservar el anillo actual de inputs, visible también con mouse).
- Select usa `<select>` **nativo** (flecha del sistema, sin `appearance-none`).

## Field — `components/Field.tsx`

```ts
label?: ReactNode; htmlFor: string; help?: ReactNode; error?: ReactNode;
required?: boolean; children: ReactNode;
```
Solo **layout + textos** del campo. **Relación Field ↔ control EXPLÍCITA** (sin
`cloneElement`, sin Context, sin render-props): el consumidor pasa el mismo
`id={htmlFor}` al control y conecta `aria-*` a mano.

```tsx
<Field label="Caravana" htmlFor="tag" required>
  <Input id="tag" name="tag" required
         aria-describedby={fieldDescribedBy('tag', { help: !!help, error: !!error })}
         invalid={Boolean(error)} />
</Field>
```
- ids estables: `${htmlFor}-help`, `${htmlFor}-error` (error con `role="alert"`).
- La marca de requerido `*` la pinta Field (`aria-hidden`); la obligatoriedad la
  comunica el atributo `required` del control.
- Field **no valida** ni decide obligatoriedad.

## `className` (contrato)

Permitido para **composición/layout** (`font-mono` de caravana, márgenes, ancho,
posición). **Prohibido** redefinir tamaño/altura/borde/fondo/estado/foco. Es regla
de **API y revisión**, no una garantía del orden de clases de Tailwind.

## refs

`ref` se acepta como **prop** (idioma React 19; no hay `forwardRef` en el repo) y
apunta al elemento nativo (`<input>`/`<select>`/`<button>`).

## Divergencias (resueltas)

| Superficie | Divergencia | Estado |
|---|---|---|
| **auth** (login/register/forgot/reset/verify) | inputs `lg` (h-10/40, text-input) | **resuelto** (migrado a Input/Field, P1.4.4.3; `placeholder:text-ink-3` vía className) |
| **Reportes** | filtro `md` con 13px | **resuelto** — estandarizado a **14px** (P1.4.4.6, cambio visual aprobado) |
| **Alertas** | "input sin focus-ring" | **resuelto** — era una const **muerta**; eliminada (P1.4.4.6) |
| **HealthPlans** | padding `px-2` | **resuelto** — estandarizado a **px-3** (P1.4.4.6, cambio visual aprobado) |
| **buscadores / caravanas** | `font-mono` vía className | soportado por composición (no es variante) |
| **placeholder** | color inconsistente | auth/capture usan `text-ink-3` vía className; alta de animal sin él (preservado por consumidor) |

## Consumidores migrados

- **Button:** submits de auth (5, `lg`); ganadero `md` (NewAnimalForm, SanidadCapture,
  ReproCapture); `secondary` (botón "Buscar" del AnimalPicker).
- **Input/Select/Field:** auth (login/register/forgot/reset/verify, `lg`); alta de
  animal (`md`); Sanidad y Reproducción (`md`, tab-condicionales); AddProductForm
  (`md`, `useId` por doble render); búsqueda del AnimalPicker (`md`, mono); filtros
  de Reportes (`md`) y HealthPlans (`sm`).

## Pendientes deliberados (P1.4.4.7+)

Registrados, **no migrados** (sin ampliar alcance):

- **Botones con icono + `gap`:** WeighingForm submit (`Check` + tri-estado), Reportes
  "Exportar CSV" (`Download`), FarmMap "Mover", HealthPlans "Aplicar plan" (`Loader2`
  como spinner). Abren la **API de iconos** (composición vs. slots) y el **spinner** de
  carga (hoy `loading` solo `aria-busy` + texto).
- **Botones `sm` (h-8):** AddProductForm Guardar/Cancelar, MedicationsPanel "Agregar",
  Alertas "Reevaluar", VerificationBanner, "Nuevo medicamento".
- **Icon-only:** PhotoGallery, "marcar hecha", quitar animal (`X`) → posible variante `icon` (aria-label obligatorio).
- **`danger`** y **toggles/segmented** (selector de reporte, Tabs, Método): sin decidir.
- **Inputs residuales `md`:** WeighingForm (kg, cc, `tnum`); búsquedas con icono
  (`animales/page.tsx` `pl-8/w-64`, `FarmMap` `flex-1`) — migran con su superficie.
- **CTA-`Link`** (EmptyState, EmptyFarmState, register fallback) y `PrimaryLink`:
  navegación, **fuera** de Button por diseño.
