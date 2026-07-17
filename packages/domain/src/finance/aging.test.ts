import { describe, expect, it } from 'vitest';
import { agingBucketOf, computeAging } from './aging';

describe('agingBucketOf', () => {
  it('clasifica por días de atraso (bordes inclusive)', () => {
    expect(agingBucketOf(-5)).toBe('not_due');
    expect(agingBucketOf(0)).toBe('not_due');
    expect(agingBucketOf(1)).toBe('d1_30');
    expect(agingBucketOf(30)).toBe('d1_30');
    expect(agingBucketOf(31)).toBe('d31_60');
    expect(agingBucketOf(60)).toBe('d31_60');
    expect(agingBucketOf(90)).toBe('d61_90');
    expect(agingBucketOf(91)).toBe('d90_plus');
  });
});

describe('computeAging', () => {
  it('suma los saldos por tramo y total', () => {
    const r = computeAging([
      { outstanding: 100, daysPastDue: -3 }, // not_due
      { outstanding: 50, daysPastDue: 15 }, // d1_30
      { outstanding: 25, daysPastDue: 45 }, // d31_60
      { outstanding: 200, daysPastDue: 120 }, // d90_plus
    ]);
    expect(r.buckets.not_due).toBe(100);
    expect(r.buckets.d1_30).toBe(50);
    expect(r.buckets.d31_60).toBe(25);
    expect(r.buckets.d61_90).toBe(0);
    expect(r.buckets.d90_plus).toBe(200);
    expect(r.total).toBe(375);
  });

  it('ignora saldos en cero y lista vacía', () => {
    expect(computeAging([]).total).toBe(0);
    expect(computeAging([{ outstanding: 0, daysPastDue: 10 }]).total).toBe(0);
  });
});
