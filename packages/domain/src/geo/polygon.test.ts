import { describe, expect, it } from 'vitest';
import { InvalidPolygonError, normalizePolygonRing, polygonAreaHa, validateDeclaredAreaHa, MAX_PADDOCK_HA, toPolygonGeoJSON, METERS_PER_UNIT } from './polygon';

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

describe('una superficie tiene que poder ser una superficie', () => {
  it('rechaza negativa y cero: no existe un potrero de −50 ha', () => {
    // Se aceptaba `-50` y de ahí salía una carga animal negativa. Cero tampoco es una superficie
    // desconocida — para eso está `null`.
    expect(() => validateDeclaredAreaHa(-50)).toThrow(/mayor que cero/);
    expect(() => validateDeclaredAreaHa(0)).toThrow(/mayor que cero/);
  });

  it('un texto NO se guarda como «no sé»', () => {
    // Antes `'muchas'` se convertía en `null` en silencio: se perdía el dato y nadie se enteraba de
    // que venía mal escrito.
    expect(() => validateDeclaredAreaHa('muchas')).toThrow(/número en hectáreas/);
  });

  it('null SÍ vale: es «todavía no la sé», que no es cero', () => {
    expect(validateDeclaredAreaHa(null)).toBeNull();
    expect(validateDeclaredAreaHa(undefined)).toBeNull();
  });

  it('acepta la superficie normal de un potrero', () => {
    expect(validateDeclaredAreaHa(45.5)).toBe(45.5);
    expect(validateDeclaredAreaHa('120')).toBe(120);
  });
});

describe('un dibujo fuera de escala se rechaza, no rompe', () => {
  it('un polígono con coordenadas proyectadas NO llega a la base', () => {
    // El área derivada iba directo a una columna `numeric(14,3)`: un polígono con coordenadas
    // grandes devolvía 9×10¹⁴ ha y el endpoint contestaba 500 crudo. Un error de carga tiene que
    // decir qué está mal.
    expect(() => polygonAreaHa([[0, 0], [1e9, 0], [1e9, 1e9], [0, 1e9]])).toThrow(/otra escala/);
  });

  it('el techo está donde deja de ser un potrero', () => {
    // Un millón de hectáreas son 10.000 km²: más que la superficie agrícola de países enteros y
    // varias veces la estancia más grande del mundo.
    expect(MAX_PADDOCK_HA).toBe(1_000_000);
  });

  it('un potrero grande de verdad sigue entrando', () => {
    // La guarda no puede comerse el caso bueno: 300 ha dibujadas son un potrero normal de campo.
    const lado = Math.round(Math.sqrt(300 * 10_000) / 3); // 300 ha en unidades de canvas
    expect(polygonAreaHa([[0, 0], [lado, 0], [lado, lado], [0, lado]])).toBeCloseTo(300, 0);
  });
});
