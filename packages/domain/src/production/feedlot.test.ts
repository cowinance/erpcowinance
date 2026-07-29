import { describe, expect, it } from 'vitest';
import { computeFeedlotMetrics } from './feedlot';

describe('computeFeedlotMetrics', () => {
  it('conversión y costo del kilo ganado', () => {
    // 4000 kg de alimento, $2000, 500 kg ganados → conversión 8, costo/kg 4.
    const m = computeFeedlotMetrics({ feedKg: 4000, feedCost: 2000, kgGained: 500, avgWeightKg: 380, avgAdg: 1.2 });
    expect(m.conversion).toBe(8);
    expect(m.costPerKgGained).toBe(4);
  });

  it('sin ganancia (kgGained ≤ 0) → conversión y costo null', () => {
    const m = computeFeedlotMetrics({ feedKg: 1000, feedCost: 500, kgGained: 0, avgWeightKg: 300, avgAdg: 1 });
    expect(m.conversion).toBeNull();
    expect(m.costPerKgGained).toBeNull();
  });

  it('días a terminación: (objetivo − actual) / GDP, redondeo hacia arriba', () => {
    // faltan 60 kg a 1.2 kg/día → 50 días.
    expect(computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1, avgWeightKg: 420, avgAdg: 1.2, targetWeightKg: 480 }).daysToFinish).toBe(50);
    // 55 kg a 1.2 → 45.8 → 46.
    expect(computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1, avgWeightKg: 425, avgAdg: 1.2, targetWeightKg: 480 }).daysToFinish).toBe(46);
  });

  it('días a terminación null: sin objetivo, GDP no positivo, o ya alcanzado', () => {
    expect(computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1, avgWeightKg: 420, avgAdg: 1.2 }).daysToFinish).toBeNull();
    expect(computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1, avgWeightKg: 420, avgAdg: 0, targetWeightKg: 480 }).daysToFinish).toBeNull();
    expect(computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1, avgWeightKg: 500, avgAdg: 1.2, targetWeightKg: 480 }).daysToFinish).toBeNull();
  });
});

describe('un corral sin alimento cargado no tiene conversión perfecta', () => {
  it('conversión y costo del kilo van en null, no en cero', () => {
    // Medido en el demo antes del arreglo: feed_kg 0, kg_gained 1490 → conversion 0 y
    // cost_per_kg_gained 0. Cero acá afirma dos cosas falsas: que convierte perfecto y que engordar
    // sale gratis. Y como la regla es del dominio, el mismo cero salía en el lote y en /engorde.
    const m = computeFeedlotMetrics({ feedKg: 0, feedCost: 0, kgGained: 1490, avgWeightKg: 375, avgAdg: 0.9 });
    expect(m.conversion).toBeNull();
    expect(m.costPerKgGained).toBeNull();
  });

  it('con alimento cargado los dos números aparecen', () => {
    // La otra mitad: la guarda no puede haberse comido el caso bueno.
    const m = computeFeedlotMetrics({ feedKg: 8000, feedCost: 240_000, kgGained: 1000, avgWeightKg: 375, avgAdg: 0.9 });
    expect(m.conversion).toBe(8);
    expect(m.costPerKgGained).toBe(240);
  });

  it('alimento cargado SIN costo: la conversión se sabe, el costo no', () => {
    // Se cargó cuánto comieron pero no cuánto costó. Son dos datos distintos y se contestan por
    // separado: esconder la conversión perdería lo único que sí se sabe.
    const m = computeFeedlotMetrics({ feedKg: 8000, feedCost: 0, kgGained: 1000, avgWeightKg: 375, avgAdg: 0.9 });
    expect(m.conversion).toBe(8);
    expect(m.costPerKgGained).toBeNull();
  });
});
