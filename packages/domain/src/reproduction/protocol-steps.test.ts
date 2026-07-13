import { describe, it, expect } from 'vitest';
import { validateProtocolSteps, InvalidProtocolStepsError } from './protocol-steps';

describe('validateProtocolSteps', () => {
  it('normaliza pasos válidos (recorta action, conserva opcionales, ignora extra)', () => {
    const out = validateProtocolSteps([
      { day: 0, action: '  Implante  ', product_id: 'p1', extra: 'x' },
      { day: 8, action: 'Retiro + PGF', notes: '  dosis doble ' },
      { day: 10, action: 'IATF' },
    ]);
    expect(out).toEqual([
      { day: 0, action: 'Implante', product_id: 'p1' },
      { day: 8, action: 'Retiro + PGF', notes: 'dosis doble' },
      { day: 10, action: 'IATF' },
    ]);
  });

  it('permite arreglo vacío y múltiples pasos el mismo día, preservando orden', () => {
    expect(validateProtocolSteps([])).toEqual([]);
    const out = validateProtocolSteps([
      { day: 8, action: 'B' },
      { day: 8, action: 'A' },
    ]);
    expect(out.map((s) => s.action)).toEqual(['B', 'A']);
  });

  it('rechaza no-arreglo', () => {
    expect(() => validateProtocolSteps(null)).toThrow(InvalidProtocolStepsError);
    expect(() => validateProtocolSteps({} as any)).toThrow(InvalidProtocolStepsError);
  });

  it('rechaza day no-entero o negativo', () => {
    expect(() => validateProtocolSteps([{ day: 1.5, action: 'x' }])).toThrow(InvalidProtocolStepsError);
    expect(() => validateProtocolSteps([{ day: -1, action: 'x' }])).toThrow(InvalidProtocolStepsError);
    expect(() => validateProtocolSteps([{ day: '0', action: 'x' }])).toThrow(InvalidProtocolStepsError);
  });

  it('rechaza action vacía o ausente', () => {
    expect(() => validateProtocolSteps([{ day: 0, action: '   ' }])).toThrow(InvalidProtocolStepsError);
    expect(() => validateProtocolSteps([{ day: 0 }])).toThrow(InvalidProtocolStepsError);
  });

  it('rechaza paso no-objeto', () => {
    expect(() => validateProtocolSteps(['x'])).toThrow(InvalidProtocolStepsError);
  });
});
