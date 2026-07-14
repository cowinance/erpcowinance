# Finanzas (F-1 → F-4) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Tercer vertical de Fase 2.**
**Alcance:** contabilidad — libro mayor (partida doble), asientos automáticos desde compras/ventas,
facturas, cobros/pagos, y la web del módulo.

> Registro histórico del sprint. Cierres previos: [`inventory-completion.md`](./inventory-completion.md),
> [`commerce-completion.md`](./commerce-completion.md).

---

## 1. Objetivo

Cerrar el circuito contable sobre lo comercial: registrar el **devengado** (clientes/ventas,
compras/proveedores) y la **caja** (cobros/pagos) con **partida doble balanceada**, más el documento
fiscal (facturas). Es el sucesor natural de Comercial (ya había documentos que asentar).

## 2. Alcance implementado (una ola por commit)

- **F-1 — Libro mayor:** plan de cuentas + períodos fiscales (abrir/cerrar) + centros de costo +
  **asientos manuales balanceados** (posteados e inmutables; corregir = reversa) + **sumas y saldos**.
- **F-2 — Asientos automáticos:** al postear un documento comercial se genera un asiento balanceado
  según un **mapa rol→cuenta** por company (`system_settings`); idempotente por `journal_entry_id`.
- **F-3a — Facturas:** documento `issued`/`received` ligado a venta/compra, con **saldo derivado**;
  no re-asienta el devengado (F-2 ya lo hizo).
- **F-3b — Pagos + imputaciones + asiento de caja:** cobro/pago imputado a facturas, con el asiento
  de caja (banco/caja vs clientes/proveedores) y marcado `paid`.
- **F-4a — Web:** plan de cuentas, asientos (líneas dinámicas + reversa), sumas y saldos.
- **F-4b — Web:** facturas (emitir + contabilizar + anular), pagos (imputación guiada), config
  (mapa de posteo + cuentas bancarias).

## 3. Arquitectura y reglas únicas

```
   chart_of_accounts / fiscal_periods / cost_centers / bank_accounts (master)
                                   │
   asiento manual ──┐              │   documento (F-2) ──► PostingService ──┐
                    ├─► LedgerService.createEntryInTx (REGLA ÚNICA)          │
   pago (F-3b) ─────┘        · valida balance (validateJournalBalance)      │
                             · período abierto · cuentas imputables         │
                                   ▼                                         ▼
                      journal_entries + journal_lines  ◄── sumas y saldos (derivado)
   invoices (F-3a, saldo = total − Σ payment_allocations)  ◄── payments/allocations (F-3b)
```

- **Asiento balanceado (regla única):** `validateJournalBalance` en `@cowinance/domain` (Σdébito =
  Σcrédito, ≥2 líneas, débito XOR crédito por línea). Punto único de creación: `createEntryInTx(q, …)`,
  reusado por asientos manuales, automáticos (F-2) y de caja (F-3b), dentro de una tx ajena.
- **Inmutabilidad:** un asiento `posted` no se edita; corregir = **reversa** (contra-asiento invertido
  + original a `reversed`).
- **Período abierto obligatorio** para postear; cerrar bloquea fechas dentro del rango.
- **Devengado vs caja:** el devengado lo asienta F-2 (documento); la factura **no** re-asienta (evita
  duplicar); la caja la asienta F-3b (cobro/pago). Sin doble conteo.
- **Saldo de factura DERIVADO:** `outstanding = total − Σ payment_allocations` (fuente única).
- **Topes de imputación:** cada imputación ≤ saldo de la factura; Σ imputaciones == monto del pago.
- **Sumas y saldos** derivan de `journal_lines` (excluye reversados).

## 4. Decisiones importantes

- **Mapa rol→cuenta en `system_settings`** (7 roles: receivable, sales_income, vat_debit, purchases,
  vat_credit, payable, cash), por company; cuentas deben ser imputables.
- **`payments.account_id` = cuenta de tesorería** (FK a `chart_of_accounts`, no a `bank_accounts`): la
  API recibe `bank_account_id` y guarda el `ledger_account_id` resuelto (o el rol `cash`).
- **Disparo de posteo explícito** (`POST /finance/postings`), no acoplado a la máquina de estados de
  Commerce; expuesto en la web como "Contabilizar documento".
- **Fix RLS de 9 tablas** (patrón recurrente): 5 del core (F-1) + `system_settings` (F-2) + `invoices`
  (F-3a) + `payments`/`payment_allocations`/`bank_accounts` (F-3b).
- **Deadlock PGlite evitado:** company/moneda resueltos vía la tx `q` (no `this.db`) dentro de asientos.
- **Dependencia unidireccional Finance→Commerce** (lee documentos, sella `journal_entry_id`).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **463 tests** (F-1 mayor, F-2 posteo, F-3a facturas, F-3b pagos, dominio) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | libro mayor · system_settings · invoices · pagos (todas 3–5/5) |
| Playwright E2E (web) | `26-finanzas`, `27-finanzas-cobros` |

## 6. Trabajo diferido

- **Anular/revertir** un pago o un documento ya contabilizado (contra-asientos + revertir saldos).
- **Multi-moneda** (`exchange_rate`/`currency_amount`): hoy moneda funcional.
- **Anticipos "a cuenta"** (pago sin factura → cuenta de anticipos).
- **Secuencia automática** de `invoice_number`; estado AFIP/DGI (`tax_authority_status`).
- **Balance general y estado de resultados** (además de sumas y saldos); presupuestos (`budgets`).
- **Convergir plan de cuentas semilla** (bootstrap opcional) y centros de costo en las líneas de la UI.

## 7. Estado del roadmap

**Finanzas → COMPLETO.** Libro mayor, asientos automáticos, facturas, cobros/pagos y web, estables en
`main`, con la partida doble balanceada como regla única y la separación devengado/caja sin doble conteo.

**Siguiente: próximo vertical de Fase 2, por definir** (Nutrición, Tambo/Leche, Agricultura, RRHH…).
Mismo método: análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
