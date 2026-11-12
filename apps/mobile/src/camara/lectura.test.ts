import { describe, it, expect } from 'vitest';
import { TIPOS_DE_CODIGO, aceptarLectura, normalizarCodigo } from './lectura';

describe('normalizarCodigo', () => {
  it('devuelve la caravana tal cual cuando ya viene limpia', () => {
    expect(normalizarCodigo('0442')).toBe('0442');
    expect(normalizarCodigo('  A17 ')).toBe('A17');
  });

  it('se queda con el último tramo de una URL o una URN', () => {
    expect(normalizarCodigo('urn:tag:0123')).toBe('0123');
    expect(normalizarCodigo('https://ganado.ar/animal/0442')).toBe('0442');
    expect(normalizarCodigo('https://ganado.ar/a?tag=0442')).toBe('0442');
  });

  it('saca la puntuación de los bordes pero no la de adentro', () => {
    expect(normalizarCodigo('*0442*')).toBe('0442');
    expect(normalizarCodigo('-A-17-')).toBe('A-17');
  });

  /** Ante una lectura inservible se pide otra: confirmar un animal equivocado es peor que teclear. */
  it('devuelve null cuando no queda nada utilizable', () => {
    expect(normalizarCodigo('')).toBeNull();
    expect(normalizarCodigo('   ')).toBeNull();
    expect(normalizarCodigo('***')).toBeNull();
    expect(normalizarCodigo(null)).toBeNull();
    expect(normalizarCodigo(undefined)).toBeNull();
  });

  it('rechaza una lectura absurdamente larga en vez de truncarla', () => {
    expect(normalizarCodigo('9'.repeat(65))).toBeNull();
    expect(normalizarCodigo('9'.repeat(64))).toHaveLength(64);
  });
});

describe('TIPOS_DE_CODIGO', () => {
  /** Más formatos es más chance de leer cualquier etiqueta del corral y darla por caravana. */
  it('cubre los formatos de caravana y deja afuera el resto', () => {
    expect(TIPOS_DE_CODIGO).toContain('code128');
    expect(TIPOS_DE_CODIGO).toContain('qr');
    expect(TIPOS_DE_CODIGO).not.toContain('codabar');
    expect(TIPOS_DE_CODIGO).not.toContain('pdf417');
  });
});

/** La cámara dispara la misma lectura muchas veces por segundo. */
describe('aceptarLectura', () => {
  it('la primera lectura siempre entra', () => {
    expect(aceptarLectura('0442', null, 1000)).toBe(true);
  });

  it('el mismo código repetido enseguida se ignora', () => {
    expect(aceptarLectura('0442', { codigo: '0442', en: 1000 }, 1200)).toBe(false);
  });

  it('un código distinto entra aunque sea inmediato', () => {
    expect(aceptarLectura('0443', { codigo: '0442', en: 1000 }, 1001)).toBe(true);
  });

  it('pasada la ventana se puede volver a leer la misma caravana a propósito', () => {
    expect(aceptarLectura('0442', { codigo: '0442', en: 1000 }, 3000)).toBe(true);
  });

  it('justo en el borde de la ventana ya se acepta', () => {
    expect(aceptarLectura('0442', { codigo: '0442', en: 1000 }, 3000, 2000)).toBe(true);
    expect(aceptarLectura('0442', { codigo: '0442', en: 1000 }, 2999, 2000)).toBe(false);
  });
});
