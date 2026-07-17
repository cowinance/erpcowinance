import { describe, expect, it } from 'vitest';
import { InvalidLotError, assertLotPurpose, validateLotInput } from './lot';

describe('assertLotPurpose', () => {
  it('acepta enum o vacío, rechaza inválido', () => {
    expect(assertLotPurpose('breeding')).toBe('breeding');
    expect(assertLotPurpose('')).toBeNull();
    expect(assertLotPurpose(null)).toBeNull();
    expect(() => assertLotPurpose('cria')).toThrow(InvalidLotError);
  });
});

describe('validateLotInput', () => {
  it('normaliza un lote válido', () => {
    expect(validateLotInput({ name: '  Rodeo Cría 1  ', purpose: 'breeding' })).toEqual({ name: 'Rodeo Cría 1', purpose: 'breeding' });
  });
  it('propósito opcional → null', () => {
    expect(validateLotInput({ name: 'Rodeo' }).purpose).toBeNull();
  });
  it('exige nombre y rechaza propósito inválido', () => {
    expect(() => validateLotInput({ name: '   ' })).toThrow(InvalidLotError);
    expect(() => validateLotInput({ name: 'X', purpose: 'foo' })).toThrow(InvalidLotError);
  });
});
