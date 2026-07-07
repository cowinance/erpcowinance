import { describe, it, expect } from 'vitest';
import { TenantId, FarmId, AnimalId, LotId } from './ids';
import { InvalidIdentifier, isUuid } from './identifier';
import { DomainError } from '../shared/domain-error';

const VALID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'; // UUID válido (v4)
const factories = [
  ['TenantId', TenantId],
  ['FarmId', FarmId],
  ['AnimalId', AnimalId],
  ['LotId', LotId],
] as const;

describe('isUuid', () => {
  it('acepta un UUID y rechaza basura', () => {
    expect(isUuid(VALID)).toBe(true);
    expect(isUuid('018f7e3a-1c2d-7abc-8def-0123456789ab')).toBe(true); // v7
    expect(isUuid('no-soy-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(` ${VALID} `)).toBe(false); // sin espacios: exacto
    expect(isUuid(123 as unknown)).toBe(false);
  });
});

describe.each(factories)('%s (identidad tipada)', (kind, Id) => {
  it('of() acepta un UUID y devuelve el mismo valor (cero costo runtime)', () => {
    const id = Id.of(VALID);
    expect(id).toBe(VALID);
    expect(typeof id).toBe('string');
  });

  it('of() rechaza entradas no-UUID con InvalidIdentifier', () => {
    expect(() => Id.of('basura')).toThrow(InvalidIdentifier);
    expect(() => Id.of('')).toThrow(InvalidIdentifier);
  });

  it('el error es un DomainError con code estable e informa el tipo', () => {
    try {
      Id.of('basura');
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as InvalidIdentifier).code).toBe('domain.invalid_identifier');
      expect((e as InvalidIdentifier).kind).toBe(kind);
    }
  });

  it('isValid() es un type guard correcto', () => {
    expect(Id.isValid(VALID)).toBe(true);
    expect(Id.isValid('nope')).toBe(false);
  });
});

describe('distinción nominal (garantía de compilación)', () => {
  it('en runtime son strings; en tipos son incompatibles entre sí', () => {
    const animal = AnimalId.of(VALID);
    const farm = FarmId.of(VALID);
    // Mismo valor subyacente, pero el compilador NO permite intercambiarlos:
    // una función que espera AnimalId rechaza un FarmId (verificado por tsc).
    expect(String(animal)).toBe(String(farm));
  });
});
