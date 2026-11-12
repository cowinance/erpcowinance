import { describe, it, expect } from 'vitest';
import { anilloDe, clasificarPorCarga, type Potrero } from './potreros';

const potrero = (extra: Partial<Potrero> = {}): Potrero => ({
  id: 'p1',
  name: 'Rodeo',
  boundary: null,
  area_ha: 10,
  pasture_type: null,
  animal_count: 0,
  stocking_rate: null,
  lots: [],
  ...extra,
});

describe('anilloDe', () => {
  it('devuelve el anillo exterior de un potrero dibujado', () => {
    const p = potrero({ boundary: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10]]] } });
    expect(anilloDe(p)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('un potrero sin dibujar no tiene anillo', () => {
    expect(anilloDe(potrero())).toBeNull();
  });

  /** Menos de tres vértices no es un polígono: dibujarlo sería una raya que no significa nada. */
  it('descarta una geometría degenerada en vez de dibujarla', () => {
    expect(anilloDe(potrero({ boundary: { type: 'Polygon', coordinates: [[[0, 0], [10, 0]]] } }))).toBeNull();
    expect(anilloDe(potrero({ boundary: { type: 'Polygon', coordinates: [] } }))).toBeNull();
  });
});

/**
 * La escala es RELATIVA al propio campo. Con cortes absolutos los seis potreros reales caían en
 * la misma banda y el mapa quedaba de un solo color — informaba cero.
 */
describe('clasificarPorCarga', () => {
  const con = (...cargas: (number | null)[]) =>
    cargas.map((stocking_rate, i) => potrero({ id: `p${i}`, stocking_rate }));

  it('reparte el campo entre el más aliviado y el más cargado', () => {
    const r = clasificarPorCarga(con(0.12, 0.42, 0.81));
    expect(r).toEqual({ p0: 'menos', p1: 'medio', p2: 'mas' });
  });

  /** Son los números reales de la finca de prueba: antes todos daban el mismo color. */
  it('distingue los potreros de un campo extensivo, donde todos están por debajo de 1 an/ha', () => {
    const r = clasificarPorCarga(con(0, 0.81, 0.12, 0, 0.26, 0.42));
    expect(new Set(Object.values(r)).size).toBeGreaterThan(1);
    expect(r.p1).toBe('mas');
    expect(r.p0).toBe('menos');
  });

  it('un potrero sin superficie no entra en la escala', () => {
    const r = clasificarPorCarga(con(0.1, null, 0.9));
    expect(r.p1).toBe('sin-datos');
    expect(r.p0).toBe('menos');
    expect(r.p2).toBe('mas');
  });

  /** Pintar diferencias donde no las hay sería inventarlas. */
  it('con todos los potreros igual de cargados no inventa diferencias', () => {
    expect(clasificarPorCarga(con(0.5, 0.5, 0.5))).toEqual({ p0: 'uniforme', p1: 'uniforme', p2: 'uniforme' });
    expect(clasificarPorCarga(con(0, 0, 0))).toEqual({ p0: 'uniforme', p1: 'uniforme', p2: 'uniforme' });
  });

  it('un solo potrero no se compara con nadie', () => {
    expect(clasificarPorCarga(con(1.4))).toEqual({ p0: 'uniforme' });
  });

  it('sin potreros no devuelve nada, y no rompe', () => {
    expect(clasificarPorCarga([])).toEqual({});
  });

  it('solo potreros sin superficie quedan todos sin datos', () => {
    expect(clasificarPorCarga(con(null, null))).toEqual({ p0: 'sin-datos', p1: 'sin-datos' });
  });
});
