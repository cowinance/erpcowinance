import { describe, it, expect } from 'vitest';
import { Sex, InvalidSex } from './sex';
import { DomainError } from '../shared/domain-error';

describe('Sex · sexo del animal', () => {
  it('of() acepta F y M', () => {
    expect(Sex.of('F')).toBe('F');
    expect(Sex.of('M')).toBe('M');
  });

  it('of() rechaza cualquier valor fuera de {F, M}', () => {
    expect(() => Sex.of('f')).toThrow(InvalidSex); // minúscula no es válida
    expect(() => Sex.of('any')).toThrow(InvalidSex); // válido para animal_categories, no para Sex
    expect(() => Sex.of('')).toThrow(InvalidSex);
    expect(() => Sex.of('X')).toThrow(InvalidSex);
    expect(() => Sex.of(undefined)).toThrow(InvalidSex);
    expect(() => Sex.of(null)).toThrow(InvalidSex);
    expect(() => Sex.of(1)).toThrow(InvalidSex);
  });

  it('el error es un DomainError con code estable', () => {
    try {
      Sex.of('X');
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as InvalidSex).code).toBe('domain.invalid_sex');
    }
  });

  it('isValid() refleja qué entradas aceptaría of()', () => {
    expect(Sex.isValid('F')).toBe(true);
    expect(Sex.isValid('M')).toBe(true);
    expect(Sex.isValid('any')).toBe(false);
    expect(Sex.isValid('f')).toBe(false);
    expect(Sex.isValid(undefined)).toBe(false);
  });

  it('equals() compara por valor', () => {
    expect(Sex.equals(Sex.of('F'), Sex.of('F'))).toBe(true);
    expect(Sex.equals(Sex.of('F'), Sex.of('M'))).toBe(false);
  });

  it('isFemale()/isMale() reflejan el sexo', () => {
    expect(Sex.isFemale(Sex.of('F'))).toBe(true);
    expect(Sex.isMale(Sex.of('F'))).toBe(false);
    expect(Sex.isFemale(Sex.of('M'))).toBe(false);
    expect(Sex.isMale(Sex.of('M'))).toBe(true);
  });
});
