import { describe, expect, it } from 'vitest';
import { diasDesde } from './ahora';

const AHORA = new Date('2026-05-20T12:00:00Z').getTime();

describe('diasDesde', () => {
  it('cuenta los días enteros transcurridos', () => {
    expect(diasDesde('2026-05-20T12:00:00Z', AHORA)).toBe(0);
    expect(diasDesde('2026-05-19T12:00:00Z', AHORA)).toBe(1);
    expect(diasDesde('2026-04-20T12:00:00Z', AHORA)).toBe(30);
  });

  it('un día incompleto todavía no cuenta', () => {
    expect(diasDesde('2026-05-19T13:00:00Z', AHORA)).toBe(0);
  });

  /** Sin pesaje previo no hay «hace N días»: hay que mostrar otra cosa, no un cero. */
  it('sin fecha devuelve null, no cero', () => {
    expect(diasDesde(null, AHORA)).toBeNull();
    expect(diasDesde(undefined, AHORA)).toBeNull();
    expect(diasDesde('', AHORA)).toBeNull();
  });

  it('una fecha ilegible devuelve null en vez de NaN', () => {
    expect(diasDesde('el martes', AHORA)).toBeNull();
  });

  it('una fecha futura da negativo, no se recorta a cero', () => {
    // Pasa con el reloj del teléfono mal puesto; verlo en negativo es más honesto que un 0.
    expect(diasDesde('2026-05-25T12:00:00Z', AHORA)).toBe(-5);
  });
});
