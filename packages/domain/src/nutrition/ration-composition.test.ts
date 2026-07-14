import { describe, expect, it } from 'vitest';
import { validateRationPct, rationCostPerKg, InvalidRationCompositionError } from './ration-composition';

describe('validateRationPct', () => {
  it('acepta ingredientes que suman 100%', () => {
    expect(() => validateRationPct([{ inventory_item_id: 'a', pct: 60 }, { inventory_item_id: 'b', pct: 40 }])).not.toThrow();
    expect(() => validateRationPct([{ inventory_item_id: 'a', pct: 33.33 }, { inventory_item_id: 'b', pct: 33.34 }, { inventory_item_id: 'c', pct: 33.33 }])).not.toThrow();
  });

  it('rechaza si no suman 100%, si está vacío o si un pct no es positivo', () => {
    expect(() => validateRationPct([{ inventory_item_id: 'a', pct: 60 }, { inventory_item_id: 'b', pct: 30 }])).toThrow(InvalidRationCompositionError);
    expect(() => validateRationPct([])).toThrow(InvalidRationCompositionError);
    expect(() => validateRationPct([{ inventory_item_id: 'a', pct: 100 }, { inventory_item_id: 'b', pct: 0 }])).toThrow(InvalidRationCompositionError);
  });
});

describe('rationCostPerKg', () => {
  it('deriva el costo ponderado por porcentaje', () => {
    // 60% × 0.30 + 40% × 0.50 = 0.18 + 0.20 = 0.38
    expect(rationCostPerKg([{ inventory_item_id: 'a', pct: 60, standard_cost: 0.3 }, { inventory_item_id: 'b', pct: 40, standard_cost: 0.5 }])).toBe(0.38);
  });

  it('ítem sin costo estándar aporta 0', () => {
    // 50% × 1 + 50% × null(0) = 0.5
    expect(rationCostPerKg([{ inventory_item_id: 'a', pct: 50, standard_cost: 1 }, { inventory_item_id: 'b', pct: 50, standard_cost: null }])).toBe(0.5);
  });
});
