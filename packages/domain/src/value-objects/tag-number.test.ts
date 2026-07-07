import { describe, it, expect } from 'vitest';
import { TagNumber, InvalidTagNumber } from './tag-number';
import { DomainError } from '../shared/domain-error';

describe('TagNumber · caravana visual', () => {
  it('of() acepta una caravana y devuelve su valor', () => {
    expect(TagNumber.of('279')).toBe('279');
    expect(TagNumber.of('T21565')).toBe('T21565');
  });

  it('of() normaliza recortando espacios (misma caravana escrita distinto)', () => {
    expect(TagNumber.of('  279  ')).toBe('279');
    expect(TagNumber.of('\t900\n')).toBe('900');
  });

  it('normalización idempotente: normalizar dos veces no cambia el valor', () => {
    const once = TagNumber.of('  472 ');
    expect(TagNumber.of(once)).toBe(once);
  });

  it('of() rechaza caravana vacía o sólo espacios', () => {
    expect(() => TagNumber.of('')).toThrow(InvalidTagNumber);
    expect(() => TagNumber.of('   ')).toThrow(InvalidTagNumber);
  });

  it('of() rechaza caravana que supera el largo de la columna', () => {
    expect(() => TagNumber.of('x'.repeat(256))).toThrow(InvalidTagNumber);
    expect(TagNumber.of('x'.repeat(255))).toHaveLength(255); // el límite exacto es válido
  });

  it('el error es un DomainError con code estable', () => {
    try {
      TagNumber.of('   ');
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as InvalidTagNumber).code).toBe('domain.invalid_tag_number');
    }
  });

  it('isValid() refleja qué entradas aceptaría of()', () => {
    expect(TagNumber.isValid('279')).toBe(true);
    expect(TagNumber.isValid('  279  ')).toBe(true);
    expect(TagNumber.isValid('')).toBe(false);
    expect(TagNumber.isValid('   ')).toBe(false);
    expect(TagNumber.isValid(123 as unknown)).toBe(false);
  });
});
