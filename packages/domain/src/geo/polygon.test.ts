import { describe, expect, it } from 'vitest';
import { InvalidPolygonError, normalizePolygonRing, polygonAreaHa, toPolygonGeoJSON, METERS_PER_UNIT } from './polygon';

describe('normalizePolygonRing', () => {
  it('acepta un anillo abierto y un GeoJSON Polygon', () => {
    const ring = [[0, 0], [10, 0], [10, 10]];
    expect(normalizePolygonRing(ring)).toEqual(ring);
    expect(normalizePolygonRing({ type: 'Polygon', coordinates: [ring] })).toEqual(ring);
  });
  it('descarta el vértice de cierre duplicado', () => {
    expect(normalizePolygonRing([[0, 0], [10, 0], [10, 10], [0, 0]])).toEqual([[0, 0], [10, 0], [10, 10]]);
  });
  it('rechaza < 3 vértices distintos o entrada no poligonal', () => {
    expect(() => normalizePolygonRing([[0, 0], [10, 0]])).toThrow(InvalidPolygonError);
    expect(() => normalizePolygonRing([[0, 0], [0, 0], [0, 0]])).toThrow(InvalidPolygonError);
    expect(() => normalizePolygonRing('nope')).toThrow(InvalidPolygonError);
  });
});

describe('polygonAreaHa', () => {
  it('cuadrado de 100×100 unidades → área por shoelace con la escala del canvas', () => {
    // 100*100 = 10.000 u² × 3² m²/u² = 90.000 m² = 9 ha.
    expect(polygonAreaHa([[0, 0], [100, 0], [100, 100], [0, 100]])).toBe(9);
    expect(METERS_PER_UNIT).toBe(3);
  });
  it('es invariante al sentido de giro (horario/antihorario)', () => {
    const cw = [[0, 0], [0, 100], [100, 100], [100, 0]];
    const ccw = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(polygonAreaHa(cw)).toBe(polygonAreaHa(ccw));
  });
  it('triángulo', () => {
    // base 100 × altura 100 / 2 = 5000 u² × 9 = 45.000 m² = 4,5 ha.
    expect(polygonAreaHa([[0, 0], [100, 0], [0, 100]])).toBe(4.5);
  });
});

describe('toPolygonGeoJSON', () => {
  it('envuelve el anillo normalizado', () => {
    expect(toPolygonGeoJSON([[0, 0], [10, 0], [10, 10]])).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10]]] });
  });
});
