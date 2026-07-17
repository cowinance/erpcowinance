import { describe, expect, it } from 'vitest';
import { validateWeighing } from './weighing';

describe('validateWeighing — regla pura (Manga E3)', () => {
  it('bloquea peso vacío / no numérico', () => {
    expect(validateWeighing({ weightKg: NaN }).ok).toBe(false);
    expect(validateWeighing({ weightKg: Infinity }).error?.code).toBe('weight.invalid');
  });

  it('bloquea peso no positivo', () => {
    expect(validateWeighing({ weightKg: 0 }).error?.code).toBe('weight.non_positive');
    expect(validateWeighing({ weightKg: -5 }).ok).toBe(false);
  });

  it('bloquea peso absurdo', () => {
    const r = validateWeighing({ weightKg: 2000 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('weight.absurd');
  });

  it('acepta un peso normal sin advertencias', () => {
    const r = validateWeighing({ weightKg: 420 });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(r.requiresConfirm).toBe(false);
  });

  it('advierte fuera del rango de la categoría (sin bloquear)', () => {
    const low = validateWeighing({ weightKg: 100, minKg: 300, maxKg: 600 });
    expect(low.ok).toBe(true);
    expect(low.warnings.some((w) => w.code === 'weight.below_category')).toBe(true);
    const high = validateWeighing({ weightKg: 700, minKg: 300, maxKg: 600 });
    expect(high.warnings.some((w) => w.code === 'weight.above_category')).toBe(true);
  });

  it('pide confirmación por cambio porcentual extremo vs último', () => {
    const r = validateWeighing({ weightKg: 600, lastWeightKg: 400 }); // +50%
    expect(r.ok).toBe(true);
    expect(r.requiresConfirm).toBe(true);
    expect(r.confirm?.code).toBe('weight.extreme_change');
  });

  it('pide confirmación por ritmo imposible (kg/día)', () => {
    const r = validateWeighing({ weightKg: 450, lastWeightKg: 410, daysSinceLast: 2 }); // +20kg/2d = 10 kg/día
    expect(r.requiresConfirm).toBe(true);
  });

  it('advierte pérdida significativa sin exigir confirmación', () => {
    const r = validateWeighing({ weightKg: 350, lastWeightKg: 400 }); // -12.5%
    expect(r.ok).toBe(true);
    expect(r.requiresConfirm).toBe(false);
    expect(r.warnings.some((w) => w.code === 'weight.significant_loss')).toBe(true);
  });

  it('un cambio moderado no molesta', () => {
    const r = validateWeighing({ weightKg: 430, lastWeightKg: 400, daysSinceLast: 30 }); // +7.5%, 1kg/día
    expect(r.requiresConfirm).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });
});
