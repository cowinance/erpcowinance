/**
 * Comparativo presupuesto vs real (BG-2). Dos reglas puras:
 *
 * 1. `normalizeByAccountType`: trae el REAL (débito/crédito del mayor) al MISMO SENTIDO en que se
 *    presupuesta. El presupuesto se carga en el sentido natural de la cuenta (un gasto de 1000 =
 *    "espero gastar 1000"; un ingreso de 5000 = "espero facturar 5000"), así que el real debe
 *    normalizarse: cuentas DEUDORAS (asset/expense) → débito − crédito; cuentas ACREEDORAS
 *    (income/liability/equity) → crédito − débito. Sin esto, el comparativo miente el signo en las
 *    cuentas acreedoras.
 *
 * 2. `computeBudgetVariance`: desvío en el sentido natural (en un gasto, positivo = sobregiro; en un
 *    ingreso, positivo = por encima del objetivo) y su porcentaje, `null` si no hay presupuesto
 *    (evita la división por cero).
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Cuentas de saldo deudor: el aumento va al débito. */
const DEBIT_NORMAL = new Set<string>(['asset', 'expense']);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Real normalizado al sentido natural de la cuenta. */
export function normalizeByAccountType(type: AccountType | string, debit: number, credit: number): number {
  const d = Number(debit) || 0;
  const c = Number(credit) || 0;
  return round2(DEBIT_NORMAL.has(type) ? d - c : c - d);
}

export interface BudgetVariance {
  variance: number;
  /** variance / |budget|; null si no hay presupuesto (budget = 0). */
  variance_pct: number | null;
}

export function computeBudgetVariance(budget: number, actual: number): BudgetVariance {
  const b = Number(budget) || 0;
  const a = Number(actual) || 0;
  const variance = round2(a - b);
  const variance_pct = b === 0 ? null : round2(variance / Math.abs(b));
  return { variance, variance_pct };
}
