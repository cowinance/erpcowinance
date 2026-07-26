import { describe, expect, it } from 'vitest';
import { computeCropYields, type CropInput } from './crop-yield';

const lote = (o: Partial<CropInput> & { cropId: string }): CropInput => ({
  cropType: 'maiz',
  areaHa: 50,
  harvested: 400000,
  cost: 40000,
  ...o,
});

describe('rinde y costo por hectárea', () => {
  it('deriva el rinde de cosecha ÷ superficie', () => {
    const r = computeCropYields([lote({ cropId: 'a' })]);
    expect(r.crops[0].yieldPerHa).toBe(8000); // 400.000 / 50 ha
    expect(r.crops[0].costPerHa).toBe(800);
    expect(r.crops[0].costPerUnit).toBe(0.1);
  });

  it('sin superficie no hay nada por hectárea, y lo dice', () => {
    const r = computeCropYields([lote({ cropId: 'a', areaHa: null })]);
    expect(r.crops[0].yieldPerHa).toBeNull();
    expect(r.crops[0].costPerHa).toBeNull();
    expect(r.crops[0].caveat).toMatch(/sin superficie/i);
  });

  it('con labores y sin cosecha el costo por hectárea ya sirve', () => {
    // Media campaña ya se pagó: el costo es comparable aunque el rinde todavía no exista.
    const r = computeCropYields([lote({ cropId: 'a', harvested: 0 })]);
    expect(r.crops[0].costPerHa).toBe(800);
    expect(r.crops[0].yieldPerHa).toBeNull();
    expect(r.crops[0].caveat).toMatch(/costo por hectárea ya es comparable/i);
  });
});

describe('la comparación es contra el MISMO cultivo', () => {
  it('el índice 100 es el promedio de los lotes de ese cultivo', () => {
    const r = computeCropYields([
      lote({ cropId: 'bueno', harvested: 500000 }), // 10.000 kg/ha
      lote({ cropId: 'flojo', harvested: 300000 }), // 6.000 kg/ha
    ]);
    expect(r.crops.find((c) => c.cropId === 'bueno')!.yieldIndex).toBeGreaterThan(100);
    expect(r.crops.find((c) => c.cropId === 'flojo')!.yieldIndex).toBeLessThan(100);
  });

  it('NO MEZCLA CULTIVOS DISTINTOS EN LA MISMA ESCALA', () => {
    // Maíz y soja rinden en órdenes distintos: un índice común no significaría nada, y la soja
    // parecería un desastre solo por ser soja.
    const r = computeCropYields([
      lote({ cropId: 'maiz1', cropType: 'maiz', harvested: 400000 }), // 8.000 kg/ha
      lote({ cropId: 'soja1', cropType: 'soja', harvested: 175000 }), // 3.500 kg/ha
      lote({ cropId: 'soja2', cropType: 'soja', harvested: 165000 }), // 3.300 kg/ha
    ]);
    expect(r.crops.find((c) => c.cropId === 'maiz1')!.yieldIndex).toBeNull(); // único maíz
    expect(r.crops.find((c) => c.cropId === 'soja1')!.yieldIndex).toBeGreaterThan(100);
  });

  it('con un solo lote del cultivo no hay índice: 100 se leería como «promedio»', () => {
    const r = computeCropYields([lote({ cropId: 'solo' })]);
    expect(r.crops[0].yieldIndex).toBeNull();
  });

  it('EL PROMEDIO SE PONDERA POR SUPERFICIE', () => {
    // Promediar un lote de 2 ha y uno de 80 como si pesaran igual daría un promedio que no existió
    // en ninguna hectárea de la finca.
    const r = computeCropYields([
      lote({ cropId: 'chico', areaHa: 2, harvested: 40000 }), // 20.000 kg/ha (excepcional)
      lote({ cropId: 'grande', areaHa: 80, harvested: 480000 }), // 6.000 kg/ha
    ]);
    // Ponderado: (20.000×2 + 6.000×80) / 82 ≈ 6.341. Sin ponderar daría 13.000.
    expect(r.byType[0].meanYieldPerHa).toBeCloseTo(6341.5, 0);
  });

  it('avisa cuando un lote quedó bien por debajo de sus pares', () => {
    const r = computeCropYields([
      lote({ cropId: 'a', harvested: 500000 }),
      lote({ cropId: 'b', harvested: 500000 }),
      lote({ cropId: 'flojo', harvested: 250000 }),
    ]);
    expect(r.crops.find((c) => c.cropId === 'flojo')!.caveat).toMatch(/por debajo del promedio/i);
  });
});

describe('sin precio no hay margen', () => {
  it('SIN PRECIO NO SE INVENTA UN MARGEN', () => {
    // Un cero se leería como «no dejó nada», que es una conclusión y no una falta de dato.
    const r = computeCropYields([lote({ cropId: 'a' })]);
    expect(r.crops[0].revenue).toBeNull();
    expect(r.crops[0].margin).toBeNull();
    expect(r.byType[0].totalMargin).toBeNull();
  });

  it('con precio calcula el margen y el margen por hectárea', () => {
    const r = computeCropYields([lote({ cropId: 'a', price: 0.18 })]);
    expect(r.crops[0].revenue).toBe(72000); // 400.000 × 0,18
    expect(r.crops[0].margin).toBe(32000); // − 40.000 de labores
    expect(r.crops[0].marginPerHa).toBe(640);
  });

  it('la pérdida se nombra como pérdida', () => {
    const r = computeCropYields([lote({ cropId: 'a', price: 0.05 })]); // 20.000 contra 40.000
    expect(r.crops[0].margin).toBe(-20000);
    expect(r.crops[0].caveat).toMatch(/pérdida/i);
  });

  it('un precio inválido se trata como sin precio, no como cero', () => {
    for (const p of [0, -3, Number.NaN]) {
      const r = computeCropYields([lote({ cropId: 'a', price: p })]);
      expect(r.crops[0].margin).toBeNull();
    }
  });
});

describe('resumen por cultivo', () => {
  it('agrupa superficie, costo y margen, y ordena por superficie', () => {
    const r = computeCropYields([
      lote({ cropId: 'm1', cropType: 'maiz', areaHa: 100, cost: 80000, price: 0.18 }),
      lote({ cropId: 's1', cropType: 'soja', areaHa: 30, harvested: 100000, cost: 20000, price: 0.4 }),
    ]);
    expect(r.byType.map((t) => t.cropType)).toEqual(['maiz', 'soja']);
    expect(r.byType[0].areaHa).toBe(100);
    expect(r.byType[1].totalMargin).toBe(20000); // 40.000 − 20.000
  });

  it('sin cultivos devuelve vacío, no ceros inventados', () => {
    const r = computeCropYields([]);
    expect(r.crops).toEqual([]);
    expect(r.byType).toEqual([]);
  });
});
