import { describe, it, expect } from 'vitest';
import { Weight, InvalidWeight, WEIGHT_SCALE } from './weight';
import { DomainError } from '../shared/domain-error';

describe('Weight · peso del dominio ganadero', () => {
  it('kg() acepta un peso positivo y devuelve el valor canónico', () => {
    expect(Weight.toKg(Weight.kg(385.5))).toBe(385.5);
  });

  it('kg() normaliza a WEIGHT_SCALE decimales', () => {
    expect(WEIGHT_SCALE).toBe(3);
    expect(Weight.toKg(Weight.kg(385.554123))).toBe(385.554);
    expect(Weight.toKg(Weight.kg(385.5545))).toBe(385.555); // redondeo estándar
  });

  it('lb() convierte a kg (unidad canónica) con el factor internacional', () => {
    expect(Weight.toKg(Weight.lb(1))).toBe(0.454); // 0.45359237 → normalizado a 3 decimales
    expect(Weight.toKg(Weight.lb(100))).toBe(45.359);
  });

  it('toLb() recalcula la presentación en libras sin persistir una segunda unidad', () => {
    const w = Weight.kg(45.359);
    expect(Weight.toLb(w)).toBeCloseTo(100, 1);
  });

  it('kg() y lb() rechazan cero, negativos y no-finitos', () => {
    expect(() => Weight.kg(0)).toThrow(InvalidWeight);
    expect(() => Weight.kg(-1)).toThrow(InvalidWeight);
    expect(() => Weight.kg(NaN)).toThrow(InvalidWeight);
    expect(() => Weight.kg(Infinity)).toThrow(InvalidWeight);
    expect(() => Weight.lb(0)).toThrow(InvalidWeight);
    expect(() => Weight.lb(-5)).toThrow(InvalidWeight);
  });

  it('el error es un DomainError con code estable', () => {
    try {
      Weight.kg(-1);
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as InvalidWeight).code).toBe('domain.invalid_weight');
    }
  });

  it('isValid() refleja qué entradas aceptaría kg()', () => {
    expect(Weight.isValid(385.5)).toBe(true);
    expect(Weight.isValid(0)).toBe(false);
    expect(Weight.isValid(-1)).toBe(false);
    expect(Weight.isValid(NaN)).toBe(false);
    expect(Weight.isValid('385' as unknown)).toBe(false);
  });

  it('equals() es exacta sobre el valor canónico, sin epsilon', () => {
    expect(Weight.equals(Weight.kg(100), Weight.kg(100))).toBe(true);
    expect(Weight.equals(Weight.kg(100), Weight.kg(100.001))).toBe(false);
    // mismo peso, orígenes distintos (kg directo vs. convertido de lb) puede no ser igual — es correcto y esperado.
  });

  it('compare() ordena de forma estándar (negativo/cero/positivo)', () => {
    expect(Weight.compare(Weight.kg(100), Weight.kg(200))).toBeLessThan(0);
    expect(Weight.compare(Weight.kg(200), Weight.kg(100))).toBeGreaterThan(0);
    expect(Weight.compare(Weight.kg(100), Weight.kg(100))).toBe(0);
  });

  it('min()/max() devuelven el Weight correspondiente', () => {
    const a = Weight.kg(100);
    const b = Weight.kg(200);
    expect(Weight.min(a, b)).toBe(a);
    expect(Weight.max(a, b)).toBe(b);
    expect(Weight.min(b, a)).toBe(a);
    expect(Weight.max(b, a)).toBe(b);
  });
});
