import { describe, expect, it } from 'vitest';
import { normalizeByAccountType, computeBudgetVariance } from './budget-variance';

describe('normalizeByAccountType', () => {
  it('cuentas DEUDORAS (asset/expense): real = débito − crédito', () => {
    expect(normalizeByAccountType('expense', 1200, 0)).toBe(1200);
    expect(normalizeByAccountType('asset', 500, 100)).toBe(400);
  });

  it('cuentas ACREEDORAS (income/liability/equity): real = crédito − débito', () => {
    expect(normalizeByAccountType('income', 0, 4000)).toBe(4000);
    expect(normalizeByAccountType('liability', 200, 900)).toBe(700);
    expect(normalizeByAccountType('equity', 0, 50)).toBe(50);
  });

  it('un ingreso con débito neto queda negativo (nota de crédito)', () => {
    expect(normalizeByAccountType('income', 300, 100)).toBe(-200);
  });
});

describe('computeBudgetVariance', () => {
  it('desvío en el sentido natural (gasto: positivo = sobregiro)', () => {
    expect(computeBudgetVariance(1000, 1200)).toEqual({ variance: 200, variance_pct: 0.2 });
  });

  it('ingreso por debajo del objetivo → desvío negativo', () => {
    expect(computeBudgetVariance(5000, 4000)).toEqual({ variance: -1000, variance_pct: -0.2 });
  });

  it('sin presupuesto (0) → pct null, sin división por cero', () => {
    expect(computeBudgetVariance(0, 300)).toEqual({ variance: 300, variance_pct: null });
  });

  it('sin real → desvío = −presupuesto', () => {
    expect(computeBudgetVariance(800, 0)).toEqual({ variance: -800, variance_pct: -1 });
  });
});
