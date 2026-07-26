import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAM_AGE_ADJUSTMENTS,
  STANDARD_AGE_DAYS,
  adjustWeaningWeight,
  confidenceFor,
  damAgeAdjustment,
  sireIndexes,
} from './weaning-weight';

describe('ajuste a 205 días', () => {
  it('un ternero destetado justo a los 205 días conserva su peso', () => {
    // La interpolación no debe mover nada cuando la edad ya es la estándar.
    const r = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: 205, sex: 'M', damAgeYears: 6 });
    expect(r.adjustedKg).toBe(200);
  });

  it('el que se destetó MÁS VIEJO se corrige hacia abajo', () => {
    // Pesa más solo porque tuvo más días de pasto. Sin corregir, su padre parecería mejor.
    const viejo = adjustWeaningWeight({ weaningWeightKg: 230, birthWeightKg: 35, ageAtWeaningDays: 250, sex: 'M', damAgeYears: 6 });
    expect(viejo.adjustedKg).toBeLessThan(230);
  });

  it('el que se destetó MÁS JOVEN se corrige hacia arriba', () => {
    const joven = adjustWeaningWeight({ weaningWeightKg: 170, birthWeightKg: 35, ageAtWeaningDays: 170, sex: 'M', damAgeYears: 6 });
    expect(joven.adjustedKg).toBeGreaterThan(170);
  });

  it('dos terneros que crecieron IGUAL dan el mismo ajustado, aunque pesen distinto', () => {
    // Es el sentido entero del ajuste: la misma ganancia diaria es la misma genética.
    const a = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: 205, sex: 'M', damAgeYears: 6 });
    const b = adjustWeaningWeight({ weaningWeightKg: 235, birthWeightKg: 35, ageAtWeaningDays: 248, sex: 'M', damAgeYears: 6 });
    expect(Math.abs(a.adjustedKg - b.adjustedKg)).toBeLessThanOrEqual(1);
  });

  it('devuelve la ganancia diaria usada, que es el número comparable de fondo', () => {
    const r = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 40, ageAtWeaningDays: 200, sex: 'F', damAgeYears: 6 });
    expect(r.dailyGainKg).toBe(0.8); // (200 − 40) / 200
  });

  it('la edad estándar es 205 días', () => {
    expect(STANDARD_AGE_DAYS).toBe(205);
  });

  it('rechaza entradas imposibles en vez de devolver un número inventado', () => {
    expect(() => adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: 0, sex: 'M' })).toThrow(RangeError);
    expect(() => adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: -5, sex: 'M' })).toThrow(RangeError);
    expect(() => adjustWeaningWeight({ weaningWeightKg: Number.NaN, birthWeightKg: 35, ageAtWeaningDays: 205, sex: 'M' })).toThrow(RangeError);
  });
});

describe('ajuste por edad de la madre', () => {
  it('la vaquillona de primer parto recibe el ajuste más grande', () => {
    // Da menos leche: su ternero pesa menos por la MADRE, no por el padre. Sin esto, un toro usado
    // sobre vaquillonas parecería peor de lo que es.
    expect(damAgeAdjustment(2, 'M')).toBeGreaterThan(damAgeAdjustment(4, 'M'));
    expect(damAgeAdjustment(4, 'M')).toBeGreaterThan(damAgeAdjustment(6, 'M'));
  });

  it('la vaca en madurez plena es la referencia: ajuste cero', () => {
    for (const edad of [5, 6, 8, 10]) expect(damAgeAdjustment(edad, 'M')).toBe(0);
  });

  it('la vaca vieja vuelve a recibir ajuste', () => {
    expect(damAgeAdjustment(12, 'M')).toBeGreaterThan(0);
  });

  it('el macho recibe más ajuste que la hembra en el mismo tramo', () => {
    for (const t of DEFAULT_DAM_AGE_ADJUSTMENTS) if (t.male > 0) expect(t.male).toBeGreaterThan(t.female);
  });

  it('sin edad de madre NO se inventa un ajuste', () => {
    // Suponer «adulta» sesgaría a favor de los toros usados sobre vaquillonas, que es exactamente
    // el error que el ajuste viene a evitar.
    expect(damAgeAdjustment(null, 'M')).toBe(0);
    expect(damAgeAdjustment(undefined, 'F')).toBe(0);
  });

  it('la tabla se puede reemplazar por la de otra asociación de raza', () => {
    // Los coeficientes son una convención publicada, no una ley física.
    const propia = [{ years: 2, male: 50, female: 45 }, { years: 5, male: 0, female: 0 }];
    expect(damAgeAdjustment(2, 'M', propia)).toBe(50);
  });
});

describe('completitud del dato', () => {
  it('marca incompleto cuando falta el peso de nacimiento', () => {
    const r = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: null, ageAtWeaningDays: 205, sex: 'M', damAgeYears: 6 });
    expect(r.complete).toBe(false);
    expect(r.adjustedKg).toBeGreaterThan(0); // sirve igual, pero es menos comparable
  });

  it('marca incompleto cuando falta la edad de la madre', () => {
    const r = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: 205, sex: 'M' });
    expect(r.complete).toBe(false);
  });

  it('con todo cargado, completo', () => {
    const r = adjustWeaningWeight({ weaningWeightKg: 200, birthWeightKg: 35, ageAtWeaningDays: 205, sex: 'M', damAgeYears: 6 });
    expect(r.complete).toBe(true);
  });
});

describe('índice por toro dentro del grupo contemporáneo', () => {
  it('el toro por encima del promedio pasa de 100 y el de abajo no llega', () => {
    const idx = sireIndexes([
      { sireId: 'bueno', adjustedKg: 220 },
      { sireId: 'bueno', adjustedKg: 210 },
      { sireId: 'flojo', adjustedKg: 180 },
      { sireId: 'flojo', adjustedKg: 190 },
    ]);
    const bueno = idx.find((i) => i.sireId === 'bueno')!;
    const flojo = idx.find((i) => i.sireId === 'flojo')!;
    expect(bueno.index).toBeGreaterThan(100);
    expect(flojo.index).toBeLessThan(100);
  });

  it('el promedio ponderado de los índices da 100 — es una invariante, no una coincidencia', () => {
    const miembros = [
      { sireId: 'a', adjustedKg: 240 },
      { sireId: 'a', adjustedKg: 200 },
      { sireId: 'b', adjustedKg: 180 },
      { sireId: 'c', adjustedKg: 210 },
      { sireId: 'c', adjustedKg: 190 },
      { sireId: 'c', adjustedKg: 205 },
    ];
    const idx = sireIndexes(miembros);
    const n = idx.reduce((s, i) => s + i.n, 0);
    const ponderado = idx.reduce((s, i) => s + i.index * i.n, 0) / n;
    expect(Math.abs(ponderado - 100)).toBeLessThan(1); // margen por el redondeo a entero
  });

  it('viene ordenado del mejor al peor: es lo primero que se quiere ver', () => {
    const idx = sireIndexes([
      { sireId: 'medio', adjustedKg: 200 },
      { sireId: 'top', adjustedKg: 240 },
      { sireId: 'ultimo', adjustedKg: 160 },
    ]);
    expect(idx.map((i) => i.sireId)).toEqual(['top', 'medio', 'ultimo']);
  });

  it('un solo toro en el grupo da índice 100: no hay con qué comparar', () => {
    // Y es honesto que lo diga: no es que sea promedio, es que es el único.
    const idx = sireIndexes([
      { sireId: 'solo', adjustedKg: 300 },
      { sireId: 'solo', adjustedKg: 100 },
    ]);
    expect(idx).toHaveLength(1);
    expect(idx[0].index).toBe(100);
  });

  it('sin miembros válidos devuelve vacío, no un promedio de nada', () => {
    expect(sireIndexes([])).toEqual([]);
    expect(sireIndexes([{ sireId: 'x', adjustedKg: Number.NaN }])).toEqual([]);
  });
});

describe('confianza: no prometer precisión que no hay', () => {
  it('pocos terneros = confianza baja', () => {
    expect(confidenceFor(1)).toBe('baja');
    expect(confidenceFor(9)).toBe('baja');
  });

  it('la confianza sube con el número de hijos', () => {
    expect(confidenceFor(10)).toBe('media');
    expect(confidenceFor(29)).toBe('media');
    expect(confidenceFor(30)).toBe('alta');
    expect(confidenceFor(200)).toBe('alta');
  });

  it('el índice viene con su confianza para poder mostrarla al lado', () => {
    const idx = sireIndexes([
      { sireId: 'poco', adjustedKg: 250 },
      { sireId: 'otro', adjustedKg: 200 },
    ]);
    // Un toro con UN ternero puede salir 120 y no significa nada: la UI tiene que decirlo.
    expect(idx.find((i) => i.sireId === 'poco')!.confidence).toBe('baja');
  });
});
