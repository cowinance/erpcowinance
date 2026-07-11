# Primitivos del Design System (web) — patrón aprobado

> Doc vivo de P1.4.4. Registra el **patrón aprobado** de los primitivos web, su API
> y las divergencias pendientes. El mecanismo de densidad y el eje de tamaño están
> en [ADR-0015](../adr/0015-density-runtime-primitive-size-axis.md); la spec del
> sistema en [P1.4.2-design-system-spec.md](P1.4.2-design-system-spec.md).
>
> Estado: **Button** (P1.4.4.1c) y **Input/Select/Field** (P1.4.4.2) aprobados y
> aplicados a superficies piloto. El resto de superficies sigue sin migrar.

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
real lo confirma; **móvil tendrá su propia tabla** (touch ≥ 44px) en P1.4.4.5.

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
- Variantes diferidas (sin consumidores): `ghost`, `danger`, `icon`, `link`, `toggle`.

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

## Divergencias pendientes (no migradas)

Se preservan tal cual hasta su capítulo; **no** se unifican en silencio:

| Superficie | Divergencia | Tratamiento |
|---|---|---|
| **auth** (login/register/AuthShell/forgot/reset/verify) | inputs `lg` (h-10/40, text-input) | migrar en P1.4.4.3; hoy conservan su `inputCls`/`primaryBtnCls` |
| **Reportes** | filtro `md` con **13px** (text-body), no 14 | requiere decisión de tamaño explícita en su migración |
| **Alertas** | inputs **sin focus ring** | corregible (mejora a11y aprobada) → declarar como diferencia observable al migrar |
| **HealthPlans** | padding **px-2** (no px-3) | variante/decisión explícita al migrar |
| **buscadores / caravanas** | `font-mono` vía className | patrón de composición ya soportado (no es variante) |
| **placeholder** | color inconsistente (`text-ink-3` en auth/capture; ausente en alta de animal) | estandarizar al migrar auth/captura |

## Consumidores migrados

- **Button:** los 5 submits de autenticación (P1.4.4.1c).
- **Input/Select/Field:** `NewAnimalForm` (alta de animal, P1.4.4.2b).

## Próximos candidatos (a autorizar por capítulo)

1. **Auth** (inputs `lg` + Field) — P1.4.4.3.
2. **Formularios ganaderos** restantes (Sanidad, Reproducción, WeighingForm, AddProductForm).
3. **Filtros compactos** (Reportes `md`/13px, Alertas focus-ring, HealthPlans px-2) con sus decisiones explícitas.
4. **Button ganadero** (submit de NewAnimalForm y CTAs `md`) en la fase de botones generales.
