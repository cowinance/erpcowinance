# RRHH / Nómina (H-1 → H-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Quinto vertical de Fase 2.**
**Alcance:** empleados (maestro) y liquidaciones de sueldos que postean al libro mayor, con la web
del módulo.

> Registro histórico del sprint. Cierres previos: [`inventory-completion.md`](./inventory-completion.md),
> [`commerce-completion.md`](./commerce-completion.md), [`finance-completion.md`](./finance-completion.md),
> [`nutrition-completion.md`](./nutrition-completion.md).

---

## 1. Objetivo

Gestionar el personal y la nómina: maestro de **empleados** y **liquidaciones** que devengan el gasto
laboral y su pago, reusando el libro mayor de Finanzas (máximo leverage sobre lo ya construido). La
mano de obra es universal a toda operación ganadera.

## 2. Alcance implementado (una ola por commit)

- **H-1 — Empleados:** `employees` — CRUD (nombre, rol, tipo, ingreso, activo); terminación laboral
  (`termination_date` + `is_active=false`) distinta de la baja lógica del registro.
- **H-2 — Liquidaciones:** `payroll_runs` + `payroll_items`; máquina de estados draft→approved→paid.
  Aprobar postea el **devengado**, pagar postea la **caja**, reusando el mayor.
- **H-3 — Web:** empleados (alta + baja/reactivación) + liquidaciones (líneas con neto en preview +
  aprobar/pagar); roles de nómina agregados a la config de posteo.

## 3. Arquitectura y reglas únicas

```
   employees (maestro)
        │
   payroll_run(period) + payroll_items(gross, deductions, net=gross−deductions)
        │  computePayrollTotals (@cowinance/domain)  [Σgross = Σnet + Σdeductions]
        ├─ approved ──► LedgerService.createEntryInTx  (D sueldos=Σgross · H a pagar=Σnet · H retenciones=Σdeductions)
        └─ paid     ──► LedgerService.createEntryInTx  (D a pagar=Σnet · H caja=Σnet)
                              (roles del mapa de posteo; período abierto; REGLA ÚNICA de asientos)
```

- **Totales derivados (regla única):** `computePayrollTotals` en `@cowinance/domain` — `net = gross −
  deductions`, validación (gross≥0, 0≤deductions≤gross). El asiento balancea por construcción.
- **Asiento solo vía el mayor:** aprobar/pagar reusan `LedgerService.createEntryInTx` (punto único de
  asientos) + el mapa rol→cuenta de `PostingService` (3 roles nuevos). Nunca se arma un asiento por
  fuera del mayor.
- **Devengado (approved) vs caja (paid):** dos asientos distintos; el devengado sella
  `payroll_runs.journal_entry_id`, el pago usa `source_type='payroll_payment'`. Idempotente por
  transición (mismo estado = no-op; no duplica asientos).
- **Terminación vs baja lógica:** `termination_date`+`is_active=false` (fin de relación) es distinto de
  `deleted_at` (baja del registro).

## 4. Decisiones importantes

- **3 roles nuevos** en el mapa de posteo: `salary_expense`, `salaries_payable`,
  `payroll_withholdings` (agregados a `PostingService.ALL_ROLES` y a la config web). Falta rol → 400.
- **Pago incluido** (no diferido): al pagar se postea la caja, cerrando el loop gasto→pasivo→caja.
- **`user_id` opcional** en empleados (vínculo a un usuario del sistema), validado si viene.
- **Fix RLS de 3 tablas** (patrón recurrente): `employees` (H-1) + `payroll_runs` + `payroll_items`
  (H-2); guardias `.mjs` no-super.
- **Dependencia unidireccional HR→Finanzas** (`FinanceModule` exporta `LedgerService` + `PostingService`);
  DAG sin ciclos.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **488 tests** (H-1 empleados, H-2 liquidaciones, dominio totales) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | employees · payroll_runs · payroll_items (3/3) |
| Playwright E2E (web) | `29-rrhh` (empleado → liquidar → aprobar → pagar → Pagada) |

## 6. Trabajo diferido

- **Conceptos de nómina** detallados (haberes/descuentos por rubro; hoy gross/deductions/net agregados).
- **Anular/revertir** una liquidación aprobada/pagada (contra-asientos + revertir estado).
- **Cargas sociales patronales** (aportes del empleador, adicionales al bruto) y su asiento.
- **Recibo de sueldo** (documento) y libro de sueldos.
- **Imputación de mano de obra** a lotes/centros de costo (via `work_logs`, liga a Agricultura/Maquinaria).
- **Multi-moneda** (hoy moneda funcional).

## 7. Estado del roadmap

**RRHH/Nómina → COMPLETO.** Empleados, liquidaciones con asiento (devengado + caja) y web, estables en
`main`, con los totales de nómina como regla única y el asiento reusando el mayor de Finanzas.

**Siguiente: próximo vertical de Fase 2, por definir** (Agricultura, Maquinaria, Tambo/Leche…). Mismo
método: análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
