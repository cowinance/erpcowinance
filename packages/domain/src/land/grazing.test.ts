import { describe, expect, it } from 'vitest';
import { computeGrazingMetrics } from './grazing';

describe('computeGrazingMetrics', () => {
  it('pastoreo cerrado: días y forraje consumido', () => {
    const r = computeGrazingMetrics('2030-05-01', '2030-05-08', 3000, 1200);
    expect(r.grazing_days).toBe(7);
    expect(r.forage_consumed_kg_dm_ha).toBe(1800);
    expect(r.is_open).toBe(false);
  });

  it('pastoreo abierto: sin salida → días null, is_open true', () => {
    const r = computeGrazingMetrics('2030-05-01', null, 3000, null);
    expect(r.grazing_days).toBeNull();
    expect(r.is_open).toBe(true);
    expect(r.forage_consumed_kg_dm_ha).toBeNull(); // falta el post
  });

  it('sin medición pre o post → consumo null', () => {
    expect(computeGrazingMetrics('2030-05-01', '2030-05-05', null, 1000).forage_consumed_kg_dm_ha).toBeNull();
    expect(computeGrazingMetrics('2030-05-01', '2030-05-05', 3000, null).forage_consumed_kg_dm_ha).toBeNull();
  });

  it('entrada y salida el mismo día → 0 días', () => {
    expect(computeGrazingMetrics('2030-05-01', '2030-05-01', 2500, 2500).grazing_days).toBe(0);
  });
});
