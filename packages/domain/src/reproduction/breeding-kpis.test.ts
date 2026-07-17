import { describe, expect, it } from 'vitest';
import { computeBreedingKpis } from './breeding-kpis';

describe('computeBreedingKpis', () => {
  it('deriva las tasas de eficiencia de cría', () => {
    const k = computeBreedingKpis({
      servicedFemales: 100,
      pregnancies: 90,
      weanings: 82,
      weanedKg: 14760, // 82 × 180
      breedingCows: 100,
      replacementHeifers: 25,
      totalHa: 200,
    });
    expect(k.pregnancyRate).toBe(90); // 90/100 = 90%
    expect(k.weaningRate).toBe(0.82); // 82/100 destete por vaca entorada
    expect(k.replacementRate).toBe(25); // 25/100 = 25%
    expect(k.kgWeanedPerHa).toBe(73.8); // 14760/200
  });

  it('denominadores en 0 → null (no se inventa cociente)', () => {
    const k = computeBreedingKpis({ servicedFemales: 0, pregnancies: 0, weanings: 0, weanedKg: 0, breedingCows: 0, replacementHeifers: 0, totalHa: 0 });
    expect(k.pregnancyRate).toBeNull();
    expect(k.weaningRate).toBeNull();
    expect(k.replacementRate).toBeNull();
    expect(k.kgWeanedPerHa).toBeNull();
  });

  it('weaningRate puede superar 1 (más destetes que vientres en el rango)', () => {
    expect(computeBreedingKpis({ servicedFemales: 10, pregnancies: 0, weanings: 12, weanedKg: 0, breedingCows: 0, replacementHeifers: 0, totalHa: 0 }).weaningRate).toBe(1.2);
  });
});
