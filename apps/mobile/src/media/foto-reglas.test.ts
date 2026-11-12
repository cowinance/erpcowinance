import { describe, it, expect } from 'vitest';
import {
  CALIDAD,
  LADO_MAXIMO,
  MAX_BYTES,
  bytesDeDataUrl,
  describirTamano,
  medidaDestino,
  motivoParaNoSubir,
} from './foto-reglas';

/** Un data URL con `n` bytes reales de contenido. */
const dataUrl = (bytes: number) => `data:image/jpeg;base64,${Buffer.alloc(bytes).toString('base64')}`;

describe('bytesDeDataUrl', () => {
  it('cuenta los bytes que representa, no los del base64', () => {
    expect(bytesDeDataUrl(dataUrl(1000))).toBe(1000);
    expect(bytesDeDataUrl(dataUrl(1))).toBe(1);
    expect(bytesDeDataUrl(dataUrl(2))).toBe(2);
    expect(bytesDeDataUrl(dataUrl(3))).toBe(3);
  });

  it('un texto que no es data URL vale cero en vez de romper', () => {
    expect(bytesDeDataUrl('')).toBe(0);
    expect(bytesDeDataUrl('no soy una imagen')).toBe(0);
  });
});

/**
 * Pedirle a la librería que «redimensione» a su propio tamaño es trabajo y pérdida de calidad a
 * cambio de nada, así que una foto que ya entra no se toca.
 */
describe('medidaDestino', () => {
  it('no achica lo que ya entra', () => {
    expect(medidaDestino(1600, 1200)).toBeNull();
    expect(medidaDestino(800, 600)).toBeNull();
  });

  it('achica por el lado largo y deja que el otro siga la proporción', () => {
    expect(medidaDestino(4000, 3000)).toEqual({ width: LADO_MAXIMO });
    expect(medidaDestino(3000, 4000)).toEqual({ height: LADO_MAXIMO });
  });

  it('una foto cuadrada se achica por el ancho', () => {
    expect(medidaDestino(4000, 4000)).toEqual({ width: LADO_MAXIMO });
  });

  it('dimensiones imposibles no producen una medida absurda', () => {
    expect(medidaDestino(0, 0)).toBeNull();
    expect(medidaDestino(-10, 100)).toBeNull();
    expect(medidaDestino(NaN, 100)).toBeNull();
  });
});

describe('describirTamano', () => {
  it('usa KB abajo del mega y MB con coma arriba', () => {
    expect(describirTamano(300 * 1024)).toBe('300 KB');
    expect(describirTamano(Math.round(2.4 * 1024 * 1024))).toBe('2,4 MB');
  });
});

/**
 * Un rechazo del servidor después de mandar 16 MB por una conexión de campo es el peor desenlace
 * posible. Se avisa antes de que la foto salga del teléfono.
 */
describe('motivoParaNoSubir', () => {
  it('una foto normal se sube sin aviso', () => {
    expect(motivoParaNoSubir(dataUrl(300 * 1024))).toBeNull();
  });

  it('una foto vacía se frena', () => {
    expect(motivoParaNoSubir(dataUrl(0))).toBe('La foto quedó vacía.');
    expect(motivoParaNoSubir('')).toBe('La foto quedó vacía.');
  });

  it('una foto por encima del techo del servidor se frena antes de salir', () => {
    const motivo = motivoParaNoSubir(dataUrl(MAX_BYTES + 1024));
    expect(motivo).toContain('el máximo es 12,0 MB');
  });

  it('justo en el techo todavía se intenta', () => {
    expect(motivoParaNoSubir(dataUrl(MAX_BYTES))).toBeNull();
  });
});

describe('paridad con la web', () => {
  /** Los números salen de apps/web/src/lib/image.ts: una sola decisión de producto, dos clientes. */
  it('mantiene lado máximo y calidad de la web', () => {
    expect(LADO_MAXIMO).toBe(1600);
    expect(CALIDAD).toBe(0.82);
  });

  /** El techo tiene que ser el mismo que MediaService.MAX_BYTES, o el aviso miente. */
  it('mantiene el techo del servidor', () => {
    expect(MAX_BYTES).toBe(12 * 1024 * 1024);
  });
});
