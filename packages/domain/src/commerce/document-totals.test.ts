import { describe, expect, it } from 'vitest';
import { computeDocumentTotals } from './document-totals';

describe('computeDocumentTotals', () => {
  it('deriva line_total, subtotal, impuesto y total (tax_rate como fracción)', () => {
    const r = computeDocumentTotals([
      { quantity: 10, unit_price: 100, tax_rate: 0.21 },
      { quantity: 2, unit_price: 50, tax_rate: 0.21 },
    ]);
    expect(r.lines[0]).toEqual({ line_total: 1000, tax_amount: 210 });
    expect(r.lines[1]).toEqual({ line_total: 100, tax_amount: 21 });
    expect(r.subtotal).toBe(1100);
    expect(r.tax_total).toBe(231);
    expect(r.total).toBe(1331);
  });

  it('sin tax_rate = sin impuesto', () => {
    const r = computeDocumentTotals([{ quantity: 3, unit_price: 33.33 }]);
    expect(r.lines[0]).toEqual({ line_total: 99.99, tax_amount: 0 });
    expect(r.subtotal).toBe(99.99);
    expect(r.tax_total).toBe(0);
    expect(r.total).toBe(99.99);
  });

  it('redondea a 2 decimales por línea (sin sesgo de coma flotante)', () => {
    const r = computeDocumentTotals([{ quantity: 3, unit_price: 0.1, tax_rate: 0.105 }]);
    // 3*0.1 = 0.30000000000000004 → 0.30 ; 0.30*0.105 = 0.0315 → 0.03
    expect(r.lines[0].line_total).toBe(0.3);
    expect(r.lines[0].tax_amount).toBe(0.03);
    expect(r.total).toBe(0.33);
  });

  it('documento vacío = todo en cero', () => {
    expect(computeDocumentTotals([])).toEqual({ subtotal: 0, tax_total: 0, total: 0, lines: [] });
  });
});
