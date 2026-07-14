import { describe, expect, it } from 'vitest';
import { computeDressingPct, InvalidCarcassError } from './dressing';

describe('computeDressingPct', () => {
  it('deriva el rendimiento: res 270 kg sobre 500 kg vivos = 54%', () => {
    expect(computeDressingPct(270, 500)).toBe(54);
  });

  it('redondea a 2 decimales', () => {
    expect(computeDressingPct(260, 480)).toBe(54.17); // 54.1666…
  });

  it('sin peso vivo → null (no inventa un número)', () => {
    expect(computeDressingPct(270, null)).toBeNull();
    expect(computeDressingPct(270, undefined)).toBeNull();
    expect(computeDressingPct(270, 0)).toBeNull();
  });

  it('rechaza un peso de res inválido', () => {
    expect(() => computeDressingPct(0, 500)).toThrow(InvalidCarcassError);
    expect(() => computeDressingPct(-10, 500)).toThrow(InvalidCarcassError);
  });

  it('rechaza una res más pesada que el animal vivo (imposible)', () => {
    expect(() => computeDressingPct(600, 500)).toThrow(InvalidCarcassError);
  });
});
