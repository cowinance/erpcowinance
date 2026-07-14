# Nutrición (N-1 → N-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Cuarto vertical de Fase 2.**
**Alcance:** raciones (fórmula + ingredientes de inventario) y entregas a lote que descuentan stock,
con la web del módulo.

> Registro histórico del sprint. Cierres previos: [`inventory-completion.md`](./inventory-completion.md),
> [`commerce-completion.md`](./commerce-completion.md), [`finance-completion.md`](./finance-completion.md).

---

## 1. Objetivo

Gestionar la alimentación: definir **raciones** (fórmulas compuestas por ítems de Inventario) y
registrar **entregas a lote** que **descuentan stock** con costo real. Cierra el «consumo integrado»
que el vertical Inventario dejó explícitamente diferido, reusando su regla única de stock.

## 2. Alcance implementado (una ola por commit)

- **N-1 — Raciones:** `rations` (nombre, categoría objetivo, datos nutricionales) + `ration_ingredients`
  (% de ítems de Inventario) con Σ% = 100; `cost_per_kg` indicativo derivado del costo estándar.
- **N-2 — Entregas a lote:** `feed_deliveries` — entregar `quantity_kg` de una ración a un lote consume
  cada ingrediente por `consumption`, con costo real (avg_cost) y prorrateo por cabeza.
- **N-3 — Web:** raciones (editor de ingredientes con Σ% en vivo) + entregas.

## 3. Arquitectura y reglas únicas

```
   rations + ration_ingredients (inventory_item_id, pct)   [Σ% = 100]
                                   │
   feed_delivery(ration, lot, warehouse, quantity_kg) ──► por ingrediente: qty = quantity_kg × pct/100
                                   │                        └─► InventoryService.recordMovementInTx('consumption', -qty)
                                   ▼                              (REGLA ÚNICA de stock, applyToLevel)
                      stock_movements (consumption) + stock_levels ↓
   total_cost = Σ (qty × avg_cost real)   ·   cost_per_head = total_cost / animals_count
```

- **Fórmula bien formada (regla única):** `validateRationPct` en `@cowinance/domain` — los porcentajes
  suman 100 (±0.01), cada uno > 0. Testeable por vitest.
- **Costo indicativo vs real:** `rations.cost_per_kg` = Σ(pct/100 × `standard_cost`) — costo de
  **planificación** (derivado en `@cowinance/domain`). El costo **real** de una entrega usa el
  `avg_cost` del stock efectivamente consumido (no un estándar viejo).
- **Consumo solo vía Inventory:** la entrega invoca `InventoryService.recordMovementInTx('consumption')`
  (punto único de mutación de stock); sin saldo → 403 y la entrega entera revierte (atómica).
- **Cabezas derivadas:** `animals_count` del input o contando animales activos del lote
  (`current_lot_id`); `cost_per_head` derivado.
- **Trazabilidad:** los movimientos llevan `reference_type='feed_delivery'`, `reference_id=<entrega>`.

## 4. Decisiones importantes

- **Entrega basada en ración** (`ration_id` obligatorio); alimentado ad-hoc de un ítem, ítems con lote
  (`track_batches`) y anulación de entrega **diferidos**.
- **`rations` sin `company_id`** (solo tenant); `target_category_id` validado contra el catálogo GLOBAL
  `animal_categories` (sin tenant).
- **Fix RLS de 3 tablas** (patrón recurrente): `rations` + `ration_ingredients` (N-1) + `feed_deliveries`
  (N-2), agregadas a `RLS_TABLES` + DROP de la policy dispersa; guardias `.mjs` no-super.
- **Dependencia unidireccional Nutrition→Inventory** (reusa recordMovementInTx; DAG sin ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **476 tests** (N-1 raciones, N-2 entregas, dominio composición) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | rations · ration_ingredients · feed_deliveries (3/3) |
| Playwright E2E (web) | `28-nutricion` (componer ración → entregar → stock descontado) |

## 6. Trabajo diferido

- **Alimentado ad-hoc** (un ítem directo sin ración) y **entrega de ítems con lote** (`track_batches`).
- **Anular una entrega** (reponer stock + contra-movimiento).
- **Costo a Finanzas**: postear el consumo de alimento como gasto por lote/centro de costo.
- **Requerimientos nutricionales** por categoría (comparar la ración vs el objetivo) y planificación.
- **Curva de consumo / stock proyectado** de insumos de alimentación.

## 7. Estado del roadmap

**Nutrición → COMPLETO.** Raciones, entregas con consumo de stock y web, estables en `main`, con la
fórmula (Σ%=100) como regla única y el consumo reusando la regla única de stock de Inventario.

**Siguiente: próximo vertical de Fase 2, por definir** (Maquinaria, RRHH/Nómina, Agricultura, Tambo…).
Mismo método: análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
