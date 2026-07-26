import { describe, expect, it } from 'vitest';
import { computeGeneticCost } from './genetic-cost';

describe('costo de la genética por kilo destetado', () => {
  it('con 50% de concepción hacen falta DOS dosis por preñez', () => {
    // Es el paso que la gente olvida: una pajuela no es un ternero.
    const r = computeGeneticCost({ strawCost: 20, conceptionRatePct: 50, avgWeaningKg: 200 });
    expect(r.strawsPerPregnancy).toBe(2);
    expect(r.costPerCalf).toBe(40);
    expect(r.costPerWeanedKg).toBe(0.2);
  });

  it('la fertilidad cambia el costo tanto como el precio', () => {
    // Mismo precio, distinta concepción: el de baja fertilidad sale casi el doble.
    const bueno = computeGeneticCost({ strawCost: 20, conceptionRatePct: 80, avgWeaningKg: 200 });
    const malo = computeGeneticCost({ strawCost: 20, conceptionRatePct: 45, avgWeaningKg: 200 });
    expect(malo.costPerCalf!).toBeGreaterThan(bueno.costPerCalf! * 1.7);
  });

  it('EL SEMEN BARATO DE BAJA FERTILIDAD PUEDE SER EL MÁS CARO', () => {
    // El error más caro que se puede cometer con esta información: comparar precios de pajuela sin
    // dividir por la concepción.
    const barato = computeGeneticCost({ strawCost: 9, conceptionRatePct: 30, avgWeaningKg: 190 });
    const caro = computeGeneticCost({ strawCost: 20, conceptionRatePct: 75, avgWeaningKg: 190 });
    // 9 / 0,30 = 30 por ternero, contra 20 / 0,75 = 26,7. El «barato» sale más caro.
    expect(barato.costPerCalf!).toBeGreaterThan(caro.costPerCalf!);
  });

  it('el peso al destete reparte el costo: más kilos, menos costo por kilo', () => {
    const liviano = computeGeneticCost({ strawCost: 20, conceptionRatePct: 60, avgWeaningKg: 160 });
    const pesado = computeGeneticCost({ strawCost: 20, conceptionRatePct: 60, avgWeaningKg: 220 });
    expect(pesado.costPerWeanedKg!).toBeLessThan(liviano.costPerWeanedKg!);
  });

  it('sin tasa de concepción NO se inventa un costo', () => {
    // No se sabe cuántas dosis hacen falta. Un cero se leería como «gratis», que es la lectura más
    // peligrosa posible acá.
    const r = computeGeneticCost({ strawCost: 20, conceptionRatePct: null, avgWeaningKg: 200 });
    expect(r.strawsPerPregnancy).toBeNull();
    expect(r.costPerCalf).toBeNull();
    expect(r.costPerWeanedKg).toBeNull();
  });

  it('tasa CERO es incalculable, no infinito', () => {
    // Ese toro no preñó nada: dividir daría infinito y la pantalla mostraría «Infinity».
    const r = computeGeneticCost({ strawCost: 20, conceptionRatePct: 0, avgWeaningKg: 200 });
    expect(r.costPerCalf).toBeNull();
  });

  it('sin peso al destete se conoce el costo por ternero pero no por kilo', () => {
    // Se informa lo que SÍ se puede: el eslabón que falta no borra el que está.
    const r = computeGeneticCost({ strawCost: 20, conceptionRatePct: 50, avgWeaningKg: null });
    expect(r.costPerCalf).toBe(40);
    expect(r.costPerWeanedKg).toBeNull();
  });

  it('un precio inválido no propaga basura', () => {
    for (const precio of [Number.NaN, -5]) {
      const r = computeGeneticCost({ strawCost: precio, conceptionRatePct: 60, avgWeaningKg: 200 });
      expect(r.costPerWeanedKg).toBeNull();
    }
  });

  it('semen regalado da costo cero, que es distinto de incalculable', () => {
    const r = computeGeneticCost({ strawCost: 0, conceptionRatePct: 60, avgWeaningKg: 200 });
    expect(r.costPerCalf).toBe(0);
    expect(r.costPerWeanedKg).toBe(0);
  });
});
