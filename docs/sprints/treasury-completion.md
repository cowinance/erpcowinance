# Cierre de sprint — Tesorería y bancos (G3)

**Estado:** COMPLETO. Vertical 18 de Fase 2. Extensión del módulo Finanzas (nuevo controller/service
`treasury` dentro de `finance`). Módulo **G3 · Tesorería y bancos [Fase 2]** del Catálogo Maestro.

## 1. Qué se construyó

- **Capa de análisis SIN tablas propias** (3ª de composición pura, tras Feedlot y Cría). Compone pagos
  (`payments`), imputaciones (`payment_allocations`), cuentas bancarias (`bank_accounts`) y facturas
  (`invoices`). Aprovecha las tablas ya sembradas en F-3b, que no tenían vista de tesorería.
- **API** `GET /treasury/summary?from&to` — 4 secciones:
  1. **Liquidez** por cuenta (saldo = Σ entradas − Σ salidas de sus pagos) + total.
  2. **Flujo de caja** del período: cobros (inbound) vs pagos (outbound), neto, serie mensual.
  3. **Aging** de saldos abiertos (CxC=issued / CxP=received) por tramos.
  4. **Días de cobro/pago** (proxy DSO/DPO): promedio (fecha de pago − emisión) por imputación.
- **Web** `/finanzas/tesoreria`: pestaña nueva en `FinanceNav`; KPIs + liquidez por cuenta + aging CxC/CxP.

## 2. Regla única (dominio)

- **`computeAging` / `agingBucketOf`** (`packages/domain/src/finance/aging.ts`): clasifica cada saldo
  por días de atraso en tramos `not_due` / `d1_30` / `d31_60` / `d61_90` / `d90_plus` y suma por tramo.

## 3. Reglas reusadas (no re-derivadas)

- **Saldo de factura** = `total − Σ payment_allocations.amount` (misma expresión que `invoices.service`).
- **Cuenta de tesorería** = `bank_accounts.ledger_account_id` unido a `payments.account_id` (misma
  relación que `payments.service.resolveCashAccount`). Gotcha confirmado: `payments.account_id` apunta a
  `chart_of_accounts`, no a `bank_accounts`; el puente es `ledger_account_id`.

## 4. Decisiones importantes

- **No duplica F-3b.** F-3b hace el *registro* (cobros/pagos + imputación + asiento de caja); G3 hace el
  *análisis* (liquidez, flujo, aging, DSO/DPO). Vive en el mismo módulo `finance` (controller/service
  aparte), sin nuevas dependencias (0 ciclos).
- **Sin tablas nuevas ni fix RLS** — reusa tablas ya protegidas.
- **Aging por días de atraso** desde `COALESCE(due_date, issue_date)`; facturas `paid`/`void` excluidas.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **601 tests** (desde 594 → +3 dominio, +4 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios (reusa tablas ya protegidas) |
| Verificación web | pestaña Tesorería integrada; render + empty states OK (demo sin datos financieros) |

El test de integración arma un escenario CONTROLADO sobre el tenant demo (el demo no siembra bancos/
pagos/facturas) con inserts directos y verifica números exactos: liquidez 1000 (1600−600); flujo
inflow 1600 / outflow 600 / neto 1000; aging CxC not_due 400 + d1_30 150 + d90_plus 200 = 750, CxP
d31_60 600 (la factura saldada queda fuera); DSO 15 / DPO 30.

## 6. Trabajo diferido

- **Conciliación bancaria** real (extractos vs. movimientos; estado conciliado) — hoy el saldo es
  derivado de pagos, no conciliado contra el banco.
- **Flujo de caja PROYECTADO** (vencimientos futuros de facturas + compromisos), no solo histórico.
- **Multi-moneda:** saldos por `currency`; hoy se listan por cuenta sin consolidar tipos de cambio.
- **Caja (no bancaria):** pagos con `account_id` que no mapea a un `bank_account` no aparecen en liquidez.

## 7. Estado del roadmap

**Tesorería y bancos → COMPLETO.** Extiende Finanzas con la vista de liquidez/aging que faltaba.

**Siguiente: por definir.** Quedan [Fase 2] puros parciales (D3·Mapas y GPS) y el hueco fundacional
A6·Documentos [Fase 1]. Los [Fase 2-3] (CRM, Costos y rentabilidad, Facturación electrónica) se meten en
Fase 3. Verificar en el Catálogo antes de elegir.
