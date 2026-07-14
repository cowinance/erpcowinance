import { describe, expect, it } from 'vitest';
import { computePayrollTotals, InvalidPayrollError } from './payroll-totals';

describe('computePayrollTotals', () => {
  it('deriva net por ítem y los totales (balancea: gross = net + deductions)', () => {
    const r = computePayrollTotals([
      { gross: 1000, deductions: 170 },
      { gross: 500, deductions: 85 },
    ]);
    expect(r.totalGross).toBe(1500);
    expect(r.totalDeductions).toBe(255);
    expect(r.totalNet).toBe(1245);
    expect(r.nets).toEqual([830, 415]);
    expect(r.totalNet + r.totalDeductions).toBe(r.totalGross);
  });

  it('sin deducciones: net = gross', () => {
    const r = computePayrollTotals([{ gross: 800 }]);
    expect(r.totalDeductions).toBe(0);
    expect(r.totalNet).toBe(800);
  });

  it('rechaza vacío, gross negativo, deductions > gross y total cero', () => {
    expect(() => computePayrollTotals([])).toThrow(InvalidPayrollError);
    expect(() => computePayrollTotals([{ gross: -1 }])).toThrow(InvalidPayrollError);
    expect(() => computePayrollTotals([{ gross: 100, deductions: 120 }])).toThrow(InvalidPayrollError);
    expect(() => computePayrollTotals([{ gross: 0 }])).toThrow(InvalidPayrollError);
  });
});
