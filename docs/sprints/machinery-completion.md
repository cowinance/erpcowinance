# Maquinaria (MQ-1 → MQ-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Séptimo vertical de Fase 2.**
**Alcance:** maestro de máquinas, mantenimiento y combustible (que consume stock), con la web del
módulo.

> Registro histórico del sprint. Cierres previos: [`inventory-completion.md`](./inventory-completion.md),
> [`commerce-completion.md`](./commerce-completion.md), [`finance-completion.md`](./finance-completion.md),
> [`nutrition-completion.md`](./nutrition-completion.md), [`hr-completion.md`](./hr-completion.md),
> [`agriculture-completion.md`](./agriculture-completion.md).

---

## 1. Objetivo

Gestionar el parque de máquinas y sus costos operativos: **maestro** de máquinas, **mantenimiento**
(preventivo/correctivo) y **combustible** (que descuenta stock con costo real). Completa el enganche de
Agricultura (`crop_operations.machinery_id`) y reusa la regla única de stock de Inventory + empleados
de RRHH.

## 2. Alcance implementado (una ola por commit)

- **MQ-1 — Máquinas:** `machinery` (tipo, marca/modelo/año/patente, horas/km) con estados
  active↔maintenance / retired.
- **MQ-2 — Mantenimiento + combustible:** `maintenance_records` (actualiza horas del maestro) +
  `fuel_logs` (con ítem → consume stock, costo real; actualiza odómetro/horas).
- **MQ-3 — Web:** máquinas (alta + estados) + detalle por máquina (mantenimiento + combustible).

## 3. Arquitectura y reglas únicas

```
   machinery (maestro)  [active↔maintenance / retired]
        │
   maintenance_record(engine_hours?) ──► actualiza machinery.engine_hours
   fuel_log(item?, warehouse?, liters) ──(ítem)──► InventoryService.recordMovementInTx('consumption', -liters)
        │                                           total_cost = liters × avg_cost real
        └─► actualiza machinery.odometer_km / engine_hours (última lectura)
```

- **Consumo solo vía Inventory:** una carga de combustible con ítem descuenta stock por
  `recordMovementInTx('consumption')` (punto único); sin saldo → 403 y la carga revierte (atómica).
  Mismo patrón que Nutrición/Agricultura.
- **Costo real:** `total_cost` de una carga con ítem = `liters × avg_cost` del stock; sin ítem →
  `liters × unit_cost` manual.
- **Lecturas del maestro:** mantenimiento y combustible actualizan `engine_hours`/`odometer_km` de la
  máquina (última lectura).
- **Estados:** transiciones validadas (409 si inválida); retired terminal.

## 4. Decisiones importantes

- **`work_logs` NO es de Maquinaria:** no referencia `machinery_id` (son horas de EMPLEADO por
  tarea/finca) → concepto de RRHH; se difiere. Corrección al split original.
- **`machinery` sin `company_id`** (tenant + `farm_id`, resuelto por finca por defecto).
- **Combustible como log con o sin ítem:** con ítem consume stock; sin ítem es un registro de costo
  manual. Ítems con lote (`track_batches`) e anulación de mantenimiento/combustible diferidos.
- **Fix RLS de 3 tablas** (patrón recurrente): `machinery` (MQ-1) + `maintenance_records` +
  `fuel_logs` (MQ-2).
- **Dependencia unidireccional Machinery→Inventory.** Operario se valida por lectura directa de
  `employees` (tenant), sin acoplar módulos.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **504 tests** (MQ-1 maestro, MQ-2 mantenimiento/combustible) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | machinery · maintenance_records · fuel_logs (3/3) |
| Playwright E2E (web) | `31-maquinaria` (máquina → combustible consume stock → reflejado en inventario) |

## 6. Trabajo diferido

- **`work_logs` (partes de trabajo)** — horas de empleado por tarea/finca, en RRHH.
- **Agenda de mantenimiento** por `next_due_date` (alertas de vencimiento).
- **Anular** mantenimiento/carga (reponer stock).
- **Costo de máquina a Finanzas** (mantenimiento/combustible como gasto por centro de costo) y
  asignación a labores agrícolas (`crop_operations.machinery_id` → costo).
- **Telemetría** (`device_id`/GPS) para horas/km automáticos.

## 7. Estado del roadmap

**Maquinaria → COMPLETO.** Máquinas, mantenimiento y combustible con consumo de stock, más la web,
estables en `main`, reusando la regla única de stock de Inventory y el maestro de empleados de RRHH.

**Siguiente: próximo vertical de Fase 2, por definir** (Trazabilidad/Guías, Tambo/Leche, o extensiones
como partes de trabajo/RRHH, genética, labs). Mismo método: análisis previo aprobado, olas pequeñas,
verificación completa, un commit por ola.
