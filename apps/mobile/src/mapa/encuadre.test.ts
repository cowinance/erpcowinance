import { describe, it, expect } from 'vitest';
import { LIENZO, aPuntos, centroide, limites, viewBoxQueEncuadra } from './encuadre';

const cuadrado = (x: number, y: number, lado: number) => [
  [x, y],
  [x + lado, y],
  [x + lado, y + lado],
  [x, y + lado],
];

describe('limites', () => {
  it('abarca todos los anillos, no solo el primero', () => {
    expect(limites([cuadrado(100, 100, 50), cuadrado(400, 300, 50)])).toEqual({
      minX: 100,
      minY: 100,
      maxX: 450,
      maxY: 350,
    });
  });

  it('sin vértices utilizables devuelve null en vez de una caja infinita', () => {
    expect(limites([])).toBeNull();
    expect(limites([[]])).toBeNull();
  });

  it('ignora los vértices rotos sin descartar el anillo entero', () => {
    const anillo = [[10, 10], [NaN, 20], [30, 30], [40, null as unknown as number]];
    expect(limites([anillo])).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });
});

describe('viewBoxQueEncuadra', () => {
  /** Una finca sin mapear tiene que mostrar lo mismo que la web: el lienzo entero. */
  it('sin potreros dibujados cae al lienzo completo', () => {
    expect(viewBoxQueEncuadra([])).toBe(`0 0 ${LIENZO.ancho} ${LIENZO.alto}`);
  });

  /** Si el recorte no respeta la proporción del lienzo, un potrero cuadrado se ve rectangular. */
  it('respeta la proporción del lienzo', () => {
    const [, , ancho, alto] = viewBoxQueEncuadra([cuadrado(100, 100, 200)]).split(' ').map(Number);
    // El viewBox se redondea a dos decimales a propósito (cadenas cortas): la proporción queda
    // exacta hasta donde ese redondeo permite, que es muy por debajo de lo que el ojo distingue.
    expect(ancho / alto).toBeCloseTo(LIENZO.ancho / LIENZO.alto, 4);
  });

  it('centra el contenido', () => {
    const [x, y, ancho, alto] = viewBoxQueEncuadra([cuadrado(100, 100, 200)]).split(' ').map(Number);
    expect(x + ancho / 2).toBeCloseTo(200, 1); // centro del cuadrado en x
    expect(y + alto / 2).toBeCloseTo(200, 1);
  });

  it('deja aire alrededor: el contenido no toca el borde', () => {
    const [x, y, ancho, alto] = viewBoxQueEncuadra([cuadrado(100, 100, 200)]).split(' ').map(Number);
    expect(x).toBeLessThan(100);
    expect(y).toBeLessThan(100);
    expect(x + ancho).toBeGreaterThan(300);
    expect(y + alto).toBeGreaterThan(300);
  });

  /** Un potrero diminuto ampliado al máximo se ve como ruido, no como un potrero. */
  it('no amplía un potrero diminuto más allá del lado mínimo', () => {
    const [, , ancho] = viewBoxQueEncuadra([cuadrado(500, 350, 2)]).split(' ').map(Number);
    expect(ancho).toBeGreaterThanOrEqual(80);
  });

  it('un anillo degenerado (todos los vértices iguales) no divide por cero', () => {
    const vb = viewBoxQueEncuadra([[[500, 350], [500, 350], [500, 350]]]);
    const [x, y, ancho, alto] = vb.split(' ').map(Number);
    expect([x, y, ancho, alto].every(Number.isFinite)).toBe(true);
    expect(ancho).toBeGreaterThan(0);
    expect(alto).toBeGreaterThan(0);
  });

  it('varios potreros dispersos entran todos en el recorte', () => {
    const [x, y, ancho, alto] = viewBoxQueEncuadra([cuadrado(50, 50, 40), cuadrado(900, 600, 40)])
      .split(' ')
      .map(Number);
    expect(x).toBeLessThanOrEqual(50);
    expect(y).toBeLessThanOrEqual(50);
    expect(x + ancho).toBeGreaterThanOrEqual(940);
    expect(y + alto).toBeGreaterThanOrEqual(640);
  });
});

describe('centroide y aPuntos', () => {
  it('el centroide cae en el medio de la caja, para poner la etiqueta encima', () => {
    expect(centroide(cuadrado(100, 200, 60))).toEqual({ x: 130, y: 230 });
    expect(centroide([])).toBeNull();
  });

  it('aPuntos arma el atributo del polígono y descarta vértices rotos', () => {
    expect(aPuntos([[1, 2], [3, 4]])).toBe('1,2 3,4');
    expect(aPuntos([[1, 2], [NaN, 4], [5, 6]])).toBe('1,2 5,6');
    expect(aPuntos([])).toBe('');
  });
});
