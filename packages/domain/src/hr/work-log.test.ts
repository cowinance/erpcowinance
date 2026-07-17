import { describe, expect, it } from 'vitest';
import { validateWorkLogHours, InvalidWorkLogError, MAX_WORK_LOG_HOURS } from './work-log';

describe('validateWorkLogHours', () => {
  it('acepta horas válidas y redondea a 3 decimales', () => {
    expect(validateWorkLogHours(8)).toBe(8);
    expect(validateWorkLogHours('7.5')).toBe(7.5);
    expect(validateWorkLogHours(2.12345)).toBe(2.123);
    expect(validateWorkLogHours(MAX_WORK_LOG_HOURS)).toBe(24); // el límite es inclusivo
  });

  it('rechaza cero o negativo', () => {
    expect(() => validateWorkLogHours(0)).toThrow(InvalidWorkLogError);
    expect(() => validateWorkLogHours(-1)).toThrow(InvalidWorkLogError);
  });

  it('rechaza más de un día natural', () => {
    expect(() => validateWorkLogHours(24.5)).toThrow(InvalidWorkLogError);
  });

  it('rechaza valores no numéricos', () => {
    expect(() => validateWorkLogHours('abc')).toThrow(InvalidWorkLogError);
    expect(() => validateWorkLogHours(null)).toThrow(InvalidWorkLogError);
    expect(() => validateWorkLogHours(undefined)).toThrow(InvalidWorkLogError);
  });
});
