import { describe, expect, it } from 'vitest';
import { sireCareers, type ContemporaryGroupResult } from './sire-career';
import type { SireIndex } from './weaning-weight';

const idx = (sireId: string, n: number, index: number): SireIndex => ({
  sireId,
  n,
  index,
  meanKg: 0, // no participa del combinado: los kilos de años distintos no son comparables
  confidence: 'baja',
});

describe('la carrera de un toro, no una temporada', () => {
  it('LA CONFIANZA SUBE AL SUMAR TEMPORADAS — el motivo de todo esto', () => {
    // Con 8 terneros por año la confianza es «baja» las tres veces, y el productor no puede decidir
    // una compra con eso. Los mismos 24 terneros juntos ya son «media».
    const g: ContemporaryGroupResult[] = [
      { year: 2024, indexes: [idx('T1', 8, 105)] },
      { year: 2025, indexes: [idx('T1', 8, 105)] },
      { year: 2026, indexes: [idx('T1', 8, 105)] },
    ];
    const [t1] = sireCareers(g);
    expect(t1.n).toBe(24);
    expect(t1.confidence).toBe('media');
    expect(t1.index).toBe(105);
  });

  it('PONDERA POR TERNEROS: una temporada de 2 crías no pesa como una de 20', () => {
    // Sin ponderar, un año flojo con dos terneros arrastraría el promedio igual que uno bueno con
    // veinte, y el toro parecería peor de lo que es por una temporada donde casi no se usó.
    const g: ContemporaryGroupResult[] = [
      { year: 2025, indexes: [idx('T1', 20, 110)] },
      { year: 2026, indexes: [idx('T1', 2, 90)] },
    ];
    const [t1] = sireCareers(g);
    // (110×20 + 90×2) / 22 = 108,2 → 108. El promedio simple daría 100.
    expect(t1.index).toBe(108);
    expect(t1.n).toBe(22);
  });

  it('no promedia KILOS entre años: solo índices', () => {
    // Los pesos crudos de años distintos no son comparables —un año seco baja a todos—, y por eso
    // `meanKg` no entra en el combinado. Los índices sí: ya vienen normalizados contra su grupo.
    const g: ContemporaryGroupResult[] = [
      { year: 2025, indexes: [{ ...idx('T1', 10, 110), meanKg: 180 }] },
      { year: 2026, indexes: [{ ...idx('T1', 10, 110), meanKg: 240 }] }, // año bueno: +60 kg
    ];
    const [t1] = sireCareers(g);
    expect(t1.index).toBe(110); // el año bueno NO lo mejora: sus contemporáneos también subieron
    expect(t1).not.toHaveProperty('meanKg');
  });

  it('guarda el detalle por temporada, de la más reciente a la más vieja', () => {
    // Un índice combinado esconde si el toro viene mejorando o si una sola temporada lo salvó.
    const g: ContemporaryGroupResult[] = [
      { year: 2024, indexes: [idx('T1', 5, 95)] },
      { year: 2026, indexes: [idx('T1', 5, 115)] },
      { year: 2025, indexes: [idx('T1', 5, 105)] },
    ];
    const [t1] = sireCareers(g);
    expect(t1.years).toEqual([2026, 2025, 2024]);
    expect(t1.by_year.map((x) => x.index)).toEqual([115, 105, 95]);
  });

  it('varios toros, ordenados por índice combinado', () => {
    const g: ContemporaryGroupResult[] = [
      { year: 2025, indexes: [idx('T1', 10, 95), idx('T2', 10, 115)] },
      { year: 2026, indexes: [idx('T1', 10, 95), idx('T2', 10, 115)] },
    ];
    expect(sireCareers(g).map((s) => s.sireId)).toEqual(['T2', 'T1']);
  });

  it('un toro de una sola temporada conserva su índice', () => {
    const g: ContemporaryGroupResult[] = [{ year: 2026, indexes: [idx('T1', 12, 103)] }];
    expect(sireCareers(g)[0]).toMatchObject({ index: 103, n: 12, years: [2026] });
  });

  it('sin grupos no inventa nada', () => {
    expect(sireCareers([])).toEqual([]);
    expect(sireCareers([{ year: 2026, indexes: [] }])).toEqual([]);
  });
});
