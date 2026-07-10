import { describe, it, expect } from 'vitest';
import { computeWithdrawal } from './withdrawal';

/**
 * Misma tabla de valores que el oráculo golden (F0):
 * apps/api/test/business-rules.golden.test.ts + docs/golden/business-rules.md.
 * Prueba de no-cambio: la función extraída reproduce exactamente el
 * comportamiento que tenía health.service.ts/SyncContext.tsx.
 */
describe('computeWithdrawal · retiro de carne', () => {
  it.each([
    ['2026-07-01T10:00:00.000Z', 35, '2026-08-05'],
    ['2026-07-01T10:00:00.000Z', 28, '2026-07-29'],
    ['2026-02-15T00:00:00.000Z', 35, '2026-03-22'], // cruza fin de febrero (2026 no bisiesto)
  ])('aplicado %s + %i días → %s', (applied, days, expected) => {
    expect(computeWithdrawal(new Date(applied), days, null).meatWithdrawalUntil).toBe(expected);
  });

  it('0 días o null → sin retiro', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), 0, null).meatWithdrawalUntil).toBeNull();
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, null).meatWithdrawalUntil).toBeNull();
  });

  it('propiedad: el retiro cae exactamente N días después de la fecha de aplicación', () => {
    const applied = new Date('2026-09-10T14:30:00.000Z');
    for (const days of [1, 7, 35, 120]) {
      const until = computeWithdrawal(applied, days, null).meatWithdrawalUntil!;
      const diff = (Date.parse(`${until}T00:00:00.000Z`) - Date.parse('2026-09-10T00:00:00.000Z')) / 86400000;
      expect(diff).toBe(days);
    }
  });
});

describe('computeWithdrawal · retiro de leche', () => {
  it('96 h después conserva la hora del día (timestamp completo)', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, 96).milkWithdrawalUntil).toBe(
      '2026-07-05T10:00:00.000Z',
    );
  });

  it('0 horas o null → sin retiro', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, 0).milkWithdrawalUntil).toBeNull();
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, null).milkWithdrawalUntil).toBeNull();
  });
});

describe('computeWithdrawal · ambos a la vez (uso real: un producto define ambos)', () => {
  it('calcula carne y leche independientemente en la misma llamada', () => {
    const result = computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), 35, 96);
    expect(result.meatWithdrawalUntil).toBe('2026-08-05');
    expect(result.milkWithdrawalUntil).toBe('2026-07-05T10:00:00.000Z');
  });
});
