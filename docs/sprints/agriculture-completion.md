# Agricultura (AG-1 → AG-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Sexto vertical de Fase 2.**
**Alcance:** cultivos sobre potreros, labores que consumen insumos y cosechas con rinde, con la web
del módulo.

> Registro histórico del sprint. Cierres previos: [`inventory-completion.md`](./inventory-completion.md),
> [`commerce-completion.md`](./commerce-completion.md), [`finance-completion.md`](./finance-completion.md),
> [`nutrition-completion.md`](./nutrition-completion.md), [`hr-completion.md`](./hr-completion.md).

---

## 1. Objetivo

Gestionar la producción agrícola: **cultivos** sobre potreros (extiende `land`), **labores** que
consumen insumos del stock (mismo patrón que Nutrición) y **cosechas** que registran el rinde y
opcionalmente suman el grano al inventario. Hub que reusa Inventory + Land + RRHH.

## 2. Alcance implementado (una ola por commit)

- **AG-1 — Cultivos:** `crops` sobre un paddock, con estados planned→growing→harvested/failed.
- **AG-2 — Labores + cosechas:** `crop_operations` (consumen insumos por `consumption`, con operario)
  + `harvests` (rinde derivado; opcionalmente suman el grano al stock).
- **AG-3 — Web:** cultivos (alta + estados) + detalle por cultivo (labores + cosechas). Se agregó un
  `POST /paddocks` mínimo (land) para poder crear cultivos sin el seed demo.

## 3. Arquitectura y reglas únicas

```
   crops (sobre paddocks/land)  [planned→growing→harvested/failed]
        │
   crop_operation(item?, qty?, warehouse?) ──(insumo)──► InventoryService.recordMovementInTx('consumption', -qty)
        │                                                 cost = qty × avg_cost real
   harvest(yield_quantity, destination_item?) ──(a stock)─► recordMovementInTx('in', +yield)  → crop='harvested'
        │  yield_per_ha = yield_quantity / crop.area_ha (derivado)
```

- **Consumo solo vía Inventory:** una labor con insumo descuenta stock por `recordMovementInTx('consumption')`
  (punto único de mutación); sin saldo → 403 y la labor revierte (atómica). Mismo patrón que la entrega
  de alimento (Nutrición).
- **Costo real:** el costo de una labor con insumo = `qty × avg_cost` del stock consumido (no un
  estándar); labor sin insumo → costo manual opcional.
- **Rinde derivado:** `yield_per_ha = yield_quantity / crop.area_ha`.
- **Cosecha a stock segura:** suma el grano con `unit_cost` opcional; si es null, no altera el
  `avg_cost` del ítem destino. Registrar la cosecha lleva el cultivo a `harvested`.
- **Estados del cultivo:** transiciones validadas (409 si inválida); harvested/failed terminales.

## 4. Decisiones importantes

- **Labor basada en insumo opcional:** labores sin insumo (laboreo, riego) se registran sin movimiento
  de stock (costo manual). Operario validado contra `employees` activos; maquinaria por existencia.
- **`crops` sin `company_id`** (solo tenant); cuelga de `paddocks` (RESTRICT).
- **Costeo de producción diferido:** el costo acumulado del cultivo NO se asigna al grano cosechado
  (por eso el `unit_cost` del grano es opcional/manual). Ítems con lote e anulación de labor/cosecha
  también diferidos.
- **`POST /paddocks` mínimo** (land): hueco real de producto, agregado como desbloqueo (espejo de
  `POST /lots`).
- **Fix RLS de 3 tablas** (patrón recurrente): `crops` (AG-1) + `crop_operations` + `harvests` (AG-2).
- **Dependencia unidireccional Agriculture→Inventory.**

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **497 tests** (AG-1 cultivos, AG-2 labores/cosechas) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | crops · crop_operations · harvests (3/3) |
| Playwright E2E (web) | `30-agricultura` (cultivo → labor consume stock → cosecha a stock → cosechado) |

## 6. Trabajo diferido

- **Costeo de producción:** asignar el costo acumulado de las labores al grano cosechado (avg del lote).
- **Anular labor/cosecha** (reponer/retirar stock).
- **Ítems con lote** (`track_batches`) en el consumo de insumos.
- **Maquinaria** como vertical propio (hoy `machinery_id` se valida por existencia pero no se puede crear).
- **Análisis de suelo** (`soil_analyses`), planificación de campañas y rotación.
- **Costo a Finanzas** (labores/cosechas como asientos por lote/centro de costo).

## 7. Estado del roadmap

**Agricultura → COMPLETO.** Cultivos, labores con consumo de stock y cosechas con rinde, más la web,
estables en `main`, reusando la regla única de stock de Inventory y el maestro de empleados de RRHH.

**Siguiente: próximo vertical de Fase 2, por definir** (Maquinaria, Tambo/Leche…). Mismo método:
análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
