import { describe, it, expect } from 'vitest';
import { relativeTime } from './relative-time';

/** Unit del helper puro de tiempo relativo (P7-4.c.2). Determinismo por `now` inyectado. */
const NOW = new Date('2026-07-12T12:00:00.000Z');

describe('relativeTime', () => {
  it('caso 7: determinista con now fijo — reciente/minutos/horas/días', () => {
    expect(relativeTime('2026-07-12T11:59:40.000Z', NOW)).toBe('recién');
    expect(relativeTime('2026-07-12T11:45:00.000Z', NOW)).toBe('hace 15 min');
    expect(relativeTime('2026-07-12T09:00:00.000Z', NOW)).toBe('hace 3 h');
    expect(relativeTime('2026-07-10T12:00:00.000Z', NOW)).toBe('hace 2 d');
  });
  it('caso 6: fecha inválida no lanza y devuelve ""', () => {
    expect(relativeTime('no-es-fecha', NOW)).toBe('');
    expect(relativeTime('', NOW)).toBe('');
  });
  it('acepta Date además de string y nunca da tiempos negativos (reloj adelantado)', () => {
    expect(relativeTime(new Date('2026-07-12T11:00:00.000Z'), NOW)).toBe('hace 1 h');
    expect(relativeTime('2026-07-12T12:00:30.000Z', NOW)).toBe('recién'); // futuro cercano → clamp a 0
  });
});
