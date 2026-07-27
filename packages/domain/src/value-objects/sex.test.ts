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

describe('cómo lo escribe el productor → cómo lo guarda el sistema', () => {
  it('«H» ES HEMBRA: la mitad de cada planilla dejaba de entrar por esto', () => {
    // El bug real: una importación de 3.000 animales creaba 1.500. `H` de hembra es la notación de
    // campo en castellano; exigir `F` (female) rechazaba una fila por cada hembra del hato.
    expect(Sex.parse('H')).toBe('F');
    expect(Sex.parse('M')).toBe('M');
  });

  it('acepta la palabra entera y no se distrae con mayúsculas ni espacios', () => {
    expect(Sex.parse('hembra')).toBe('F');
    expect(Sex.parse('  Macho ')).toBe('M');
    expect(Sex.parse('HEMBRA')).toBe('F');
    expect(Sex.parse('female')).toBe('F');
    expect(Sex.parse('f')).toBe('F');
  });

  it('«M» es macho y male: misma letra, mismo sexo, sin ambigüedad', () => {
    expect(Sex.parse('M')).toBe(Sex.parse('macho'));
    expect(Sex.parse('M')).toBe(Sex.parse('male'));
  });

  it('NO adivina el sexo desde la categoría', () => {
    // `vaca` es hembra, sí — pero es otra columna. Deducirlo taparía un mapeo equivocado en vez de
    // señalarlo, y el productor se enteraría cuando el animal ya está cargado con el sexo inventado.
    expect(Sex.parse('vaca')).toBeNull();
    expect(Sex.parse('toro')).toBeNull();
    expect(Sex.parse('novillo')).toBeNull();
  });

  it('devuelve null en vez de lanzar cuando no entiende', () => {
    expect(Sex.parse('X')).toBeNull();
    expect(Sex.parse('')).toBeNull();
    expect(Sex.parse(null)).toBeNull();
    expect(Sex.parse(undefined)).toBeNull();
  });

  it('of() sigue siendo la frontera ESTRICTA: parse() no la afloja', () => {
    // Interpretar la planilla es trabajo del borde; adentro el sexo es {F,M} y nada más.
    expect(() => Sex.of('H')).toThrow();
    expect(() => Sex.of('hembra')).toThrow();
    expect(Sex.isValid('H')).toBe(false);
  });
});
