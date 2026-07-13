# Comercial (C-1 → C-4) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Segundo vertical de Fase 2.**
**Alcance:** activar Compras y Ventas — maestro de socios, compras con enganche a stock, ventas con
enganche a hacienda/stock, y la web del módulo.

> Registro histórico del sprint. Cierre previo: [`inventory-completion.md`](./inventory-completion.md).

---

## 1. Objetivo

Cerrar el circuito de negocio: comprar insumos/animales y **vender hacienda** — el ingreso central de
una ganadera. Reusa el kardex de Inventario (compras suman stock) y engancha a Herd (ventas marcan el
animal como vendido). Deja el terreno listo para Finanzas (documentos que asentar).

## 2. Alcance implementado (una ola por commit)

- **C-1 — Maestro de socios:** `business_partners` (supertipo) + `suppliers`/`customers` (satélites
  1:1) + `contacts`. `type ∈ {customer, supplier, both}` decide qué satélites existen. Web `/comercial`.
- **C-2 — Compras:** `purchases`/`purchase_lines`, totales derivados, máquina de estados; al pasar a
  `received`, las líneas de ítem generan un movimiento `in` en el kardex.
- **C-3 — Ventas:** `sales`/`sale_lines`; al pasar a `delivered`, las líneas de ítem generan `out` de
  stock y las líneas de animal marcan el animal como `sold` **convergente en devices**.
- **C-4 — Web:** subrutas `/comercial/compras` y `/comercial/ventas` con un `DocumentForm`/`DocumentList`
  reusables (compra|venta) y transiciones de estado contextuales.

## 3. Arquitectura y reglas únicas

```
   business_partners ─┬─ suppliers      purchases/lines ──(received)──► InventoryService
                      └─ customers      sales/lines ──(delivered)──┬──► InventoryService.recordMovementInTx (out)
                                                                   └──► AnimalStatusService.transition (sold)
   computeDocumentTotals (@cowinance/domain)  ◄── totales de compras Y ventas (una sola regla)
```

- **Totales DERIVADOS (regla única):** `computeDocumentTotals` en `@cowinance/domain` — `line_total`,
  `subtotal`, `tax_total`, `total` (`tax_rate` fracción, redondeo 2 decimales). El servidor nunca
  acepta los totales del cliente. Compartida por compras y ventas.
- **Stock solo vía Inventory:** el gancho de compras/ventas invoca
  `InventoryService.recordMovementInTx(q, …)` — punto ÚNICO de mutación de stock (regla `applyToLevel`),
  reutilizable dentro de una tx ajena (evita anidar `this.db.transaction` → deadlock PGlite).
- **Estado de animal sincronizado (regla única):** `AnimalStatusService.transition` en Herd — el único
  mecanismo para un cambio de estado que CONVERGE en devices offline (status + `status_changed_at` +
  versión LWW + evento de timeline + changeset server-origin), mismo mecanismo que la mortalidad.
- **Efectos idempotentes en la transición:** los ganchos disparan una sola vez (`received`/`delivered`);
  el stock, por existencia de movimientos con `reference_id=<doc>`; el animal, por el guard `active`.
- **Company/moneda del servidor:** company única del tenant; moneda por defecto = `functional_currency`.
- **Dependencias unidireccionales (DAG, 0 ciclos):** Commerce→Inventory y Commerce→Herd.

## 4. Decisiones importantes

- **Modelo supertipo/subtipo** honrado (no aplanado): `type='both'` habilita ambos satélites; campo de
  satélite ausente = sin cambios (COALESCE), y se reactiva al re-agregar.
- **Fix RLS de 9 tablas** (patrón recurrente): agregadas a `RLS_TABLES` + DROP de la policy dispersa
  sobre `app.current_tenant`; guardia `.mjs` no-super 5/5 (maestro + satélite + transaccional).
- **Momento del efecto:** compras en `received`, ventas en `delivered`. Cancelar tras el efecto → 409
  (reversa diferida).
- **Alcance acotado:** las líneas de **animal en compras** se registran como dato (alta en Herd
  diferida = vertical propio); la **venta de animal** sí cambia el estado (transición simple).
- **`MortalityService` se difiere:** su path acoplado a la tabla de hecho + UNIQUE queda como está;
  converger mortalidad sobre `AnimalStatusService` es un ítem pendiente.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **434 tests** (C-1 maestro, C-2 compras, C-3 ventas, totales de dominio) |
| Ciclos de dependencia (madge) | **0** |
| Guardia RLS `.mjs` (no-super) | business_partners · suppliers · sales (5/5) |
| Playwright E2E (web) | `23-comercial`, `24-comercial-compras`, `25-comercial-ventas` |

## 6. Trabajo diferido

- **Facturación/cobros y pagos** (`payments`, `payment_allocations`, `invoices`) — enganche real de caja.
- **Reversa de stock/animal** al anular un documento ya recibido/entregado.
- **Alta de animal desde una compra** (línea `animal_id` → crear el animal en Herd).
- **Precios (`price_lists`)** activos y su aplicación automática en ventas.
- **Convergir `MortalityService` sobre `AnimalStatusService`** (regla única de transición).
- **Detalle de documento en web** (líneas expandidas) y edición de líneas en `draft`.
- **Asiento contable** (`journal_entry_id`) — al activar Finanzas.

## 7. Estado del roadmap

**Comercial → COMPLETO.** Socios, compras (con stock), ventas (con hacienda/stock) y web, estables en
`main`, con totales como regla única, stock solo vía Inventory y estado de animal sincronizado.

**Siguiente: próximo vertical de Fase 2, por definir** (Finanzas es el sucesor natural — ya hay
documentos que asentar). Mismo método: análisis previo aprobado, olas pequeñas, verificación completa,
un commit por ola.
