# Inventario (INV-1 + INV-2) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Primer vertical de Fase 2 (ERP completo).**
**Alcance:** activar el módulo de Inventario — maestro (ítems/categorías/depósitos), movimientos con
kardex y saldo materializado, lotes y transferencias entre depósitos.

> Registro histórico del sprint. Cierres previos: [`billing-saas-completion.md`](./billing-saas-completion.md),
> [`r2-reproduccion-gestion-completion.md`](./r2-reproduccion-gestion-completion.md).

---

## 1. Objetivo

Las tablas de inventario existían en el esquema pero estaban **dormidas** (sin módulo ni UI). Este
vertical las activa como backbone de Fase 2: sobre él se apoyan a futuro nutrición (insumos),
agricultura, sanidad-insumos y comercial (compras que suman stock).

## 2. Alcance implementado

- **INV-1 — Maestro:** CRUD de **categorías** (kind), **ítems** (unidad del catálogo `units`,
  categoría, sku, `track_batches`, `reorder_point`, `standard_cost`) y **depósitos**; web `/inventario`.
- **INV-2a — Movimientos + existencias (kardex):** registrar movimientos (`in/out/adjustment/
  consumption`) que actualizan el saldo materializado (`stock_levels`) atómicamente; existencias por
  depósito e historial.
- **INV-2b — Lotes + transferencias:** batches con enforcement de `track_batches`, y transferencias
  entre depósitos (par atómico con el costo que viaja).

## 3. Arquitectura

```
   inventory_items / categories / warehouses (maestro)      inventory_batches (lotes)
                                   │
   POST /inventory/movements ──► recordMovement ─┐
   POST /inventory/transfers ──► recordTransfer ─┤► applyToLevel(q, item, wh, batch, delta, cost)
                                                  │   (REGLA ÚNICA de saldo)
                                                  ▼
                      stock_movements (kardex)  +  stock_levels (saldo materializado)
                                   │
                      Web /inventario (maestro + StockPanel: movimientos, transfer, existencias)
```

Invariantes:
- **Regla única de saldo:** `applyToLevel` es el único lugar que muta `stock_levels` — upsert por
  `(item, warehouse, batch)` con `IS NOT DISTINCT FROM` (batch NULL), avg_cost ponderado solo al
  entrar con `unit_cost`, y **sin stock negativo** (403). La comparten movimientos y transferencias.
- **Cantidad SIGNADA** en `stock_movements` (+ entra, − sale) → el saldo es la suma; el kardex es honesto.
- **Costo que viaja** en transferencias: el destino pondera con el `avg_cost` del origen.
- **Atomicidad:** movimiento(s) + saldo(s) en una `db.tx`.

## 4. Decisiones importantes

- **Fix RLS (5 tablas):** `inventory_categories/items`, `warehouses`, `stock_movements/levels`,
  `inventory_batches` traían la policy dispersa sobre `app.current_tenant` (que la app nunca setea) y
  no estaban en `RLS_TABLES` → se agregaron (policy estándar `app.tenant_id`) + drop de las dispersas.
  Guardias `.mjs` bajo rol no-super. **Patrón recurrente del schema** al activar tablas dormidas.
- **`track_batches` enforcement:** si el ítem controla lotes, los movimientos/transferencias exigen un
  `batch_id` válido y perteneciente al ítem.
- **Transferencia como par:** dos movimientos `transfer` (−/+) con `reference_id` compartido, atómicos.
- **`unit` desde el catálogo `units`;** `supplier_id` de los lotes nullable (proveedores es otro vertical).

## 5. Criterios de aceptación cumplidos

- Se crean ítems/categorías/depósitos; los movimientos actualizan las existencias correctamente;
  entradas ponderan el costo, salidas no; no hay stock negativo.
- Los ítems con control de lotes exigen lote; las transferencias mueven stock entre depósitos con el
  costo, atómicamente.
- Aislamiento por tenant verificado bajo rol no-super en las 5 tablas.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **416 tests** (maestro, movimientos/kardex, batches, transferencias) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | inventory_items · stock_movements · inventory_batches |
| Playwright E2E (web) | `20-inventario`, `21-inventario-movimientos`, `22-inventario-transfer` |

## 7. Decisiones diferidas y trabajo futuro

- **Alertas de reposición** (`reorder_point` ya se guarda; falta la alerta al cruzar el mínimo).
- **Consumo integrado:** que un tratamiento (sanidad) o una ración (nutrición) descuente stock
  automáticamente (movimiento `consumption` con `reference_*`).
- **Compras que suman stock** (link con el vertical Comercial + `suppliers`).
- **Valuación avanzada** (además del promedio ponderado ya implementado) y reportes de inventario.
- **Cuarentena / vencimientos** (alertas por `expiry_date` de lotes).

## 8. Estado del roadmap

**Inventario → COMPLETO.** Maestro, kardex con saldo materializado, lotes y transferencias
terminados, verificados y estables en `main`, con una regla única de saldo y RLS corregida.

**Siguiente fase: próximo vertical de Fase 2, por definir** (Comercial, Finanzas, Nutrición…). Mismo
método: análisis previo aprobado antes de código, olas pequeñas y revisables, verificación completa y
un commit por ola.
