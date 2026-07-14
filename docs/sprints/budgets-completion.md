# Presupuestos (BG-1 → BG-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Décimo vertical de Fase 2** (extensión de Finanzas).
**Alcance:** presupuesto por cuenta y mes, comparativo contra el real del mayor, y la web del módulo.

> Registro histórico del sprint. Cierres previos en `docs/sprints/`.

---

## 1. Objetivo

Dar la herramienta de gestión que faltaba sobre el libro mayor: cargar un **presupuesto anual** por
cuenta y mes, y compararlo contra el **real** (asientos posteados). Extiende Finanzas reusando el plan
de cuentas, los centros de costo y el mayor.

## 2. Alcance implementado (una ola por commit)

- **BG-1 — Presupuestos:** `budgets` (año fiscal, estados draft→approved→closed) + `budget_lines`
  (monto por cuenta × mes, centro de costo opcional), con carga de líneas **en bloque**.
- **BG-2 — Presupuesto vs real:** comparativo contra los asientos del mayor, con el signo normalizado
  por tipo de cuenta. **Además: fix de un bug de correctitud en los reportes del mayor** (ver §4).
- **BG-3 — Web:** editor de líneas + tabla de presupuesto vs real con el desvío coloreado por tipo de
  cuenta.

## 3. Arquitectura y reglas únicas

```
   budgets(fiscal_year)  +  budget_lines(account × month × amount, cost_center?)   [solo editable en draft]
                                   │
   GET /finance/budgets/:id/vs-actual  ──►  journal_lines de asientos que CUENTAN (LEDGER_COUNTS)
                                   │        del año fiscal, agregados por cuenta (y mes)
                                   ▼
   normalizeByAccountType(type, debit, credit)   ← REGLA ÚNICA (@cowinance/domain)
      deudoras (asset/expense) → débito − crédito
      acreedoras (income/liability/equity) → crédito − débito
                                   ▼
   computeBudgetVariance(budget, actual) → { variance, variance_pct | null }
```

- **Normalización por tipo de cuenta (regla única):** el presupuesto se carga en el **sentido natural**
  de la cuenta; el real debe traerse al mismo sentido. Sin esto, el comparativo **miente el signo** en
  todas las cuentas acreedoras (un ingreso real de 4000 aparecería como −4000).
- **Desvío:** `variance = actual − budget` en el sentido natural (en un gasto, positivo = sobregiro; en
  un ingreso, positivo = por encima del objetivo). `variance_pct = null` si `budget = 0` (sin división
  por cero).
- **Líneas en bloque:** `PUT /budgets/:id/lines` reemplaza el set completo de forma atómica, y **solo
  en `draft`** (aprobado/cerrado → 409).
- **El signo de `amount` no define ingreso/gasto:** eso lo da el **tipo de la cuenta** imputada.

## 4. El bug que destapó BG-2 (aprendizaje transversal de Finanzas)

Los reportes del mayor filtraban `je.status = 'posted'`. Al **reversar** un asiento, el original pasa a
`reversed` (quedaba **excluido**) pero su **contra-asiento sigue posteado** (se contaba) → **la reversa
se restaba dos veces**. Un gasto real de 1200 con una reversa de 999 daba `201` en vez de `1200`.

**Fix (regla única `LEDGER_COUNTS`):** cuentan **todos los asientos menos los borradores**
(`status <> 'draft'`). Un asiento `reversed` **sigue contando** y su contra-asiento lo cancela → el par
neto es **cero**. Aplicado a **sumas y saldos (F-1)** y al comparativo. El test de F-1 tenía la premisa
incorrecta en su comentario y se corrigió.

**Lección:** un reporte nuevo sobre datos viejos es el mejor detector de bugs latentes; el test de
integración con un caso reversado fue lo que lo expuso.

## 5. Decisiones importantes

- **Centro de costo como filtro** (`?cost_center_id=`) en ambos lados; la comparación *agrupada* por
  centro de costo queda diferida.
- **Real acotado al año fiscal** del presupuesto (1-ene..31-dic de `fiscal_year`).
- **Incluye ambos lados huérfanos:** cuentas con real sin presupuesto (`budget=0`, `pct=null`) y
  presupuestadas sin real (`actual=0`).
- **Fix RLS de 2 tablas** (patrón recurrente): `budgets` + `budget_lines`.
- El gate atrapó un `const lines = []` inferido como `never[]` — otra vez `audit:arch` completo antes de
  commitear.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **538 tests** (BG-1 presupuestos, BG-2 comparativo, dominio normalización/desvío) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | budgets · budget_lines (4/4) |
| Playwright E2E (web) | `34-presupuestos` (líneas → comparativo: 1000 vs 1200 = +200, 20%) |

## 7. Trabajo diferido

- **Comparación agrupada por centro de costo** (hoy solo filtro).
- **Presupuesto de varios años / revisiones** (reabrir un aprobado no está en el enum → se crea otro).
- **Copiar/plantillar** un presupuesto desde el año anterior o desde el real.
- **Alertas de sobregiro** (cruzar el desvío contra un umbral).
- **Desglose mensual en la web** (la API ya soporta `?by=month`).

## 8. Estado del roadmap

**Presupuestos → COMPLETO.** Presupuesto por cuenta/mes, comparativo contra el real con el signo bien
normalizado, y la web — estables en `main`. Y el mayor quedó **más correcto** que antes del sprint.

**Siguiente: próximo vertical de Fase 2, por definir** (Partes de trabajo/RRHH, Tambo/Leche…). Mismo
método: análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
