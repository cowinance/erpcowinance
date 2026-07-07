import { describe, it, expect } from 'vitest';

/**
 * GOLDEN / CHARACTERIZATION TESTS — Fase 0 (red de seguridad).
 *
 * Pinean el comportamiento ACTUAL de las reglas de negocio que la Fase 4
 * extraerá a `packages/domain` (hoy duplicadas en health.service.ts,
 * repro.service.ts y apps/mobile/SyncContext.tsx).
 *
 * Las `reference*` son copias VERBATIM de la fórmula vigente. En la Fase 4,
 * estas funciones se reemplazan por el import de `@cowinance/domain` y esta
 * MISMA tabla de valores debe seguir pasando → prueba de que la función
 * extraída no cambia el comportamiento.
 */

// --- Copias verbatim del código actual (fuente: health.service.ts:62, repro.service.ts) ---

/** health.service.ts: meatUntil = appliedAt + withdrawal_meat_days (solo fecha). 0/null → sin retiro. */
function referenceMeatWithdrawal(appliedAtISO: string, days: number | null): string | null {
  return days ? new Date(new Date(appliedAtISO).getTime() + days * 86400000).toISOString().slice(0, 10) : null;
}

/** health.service.ts: milkUntil = appliedAt + withdrawal_milk_hours (timestamp completo). 0/null → sin retiro. */
function referenceMilkWithdrawal(appliedAtISO: string, hours: number | null): string | null {
  return hours ? new Date(new Date(appliedAtISO).getTime() + hours * 3600000).toISOString() : null;
}

/** repro.service.ts: fecha probable de parto = fecha de servicio + 283 días (solo fecha). */
const GESTATION_DAYS = 283;
function referenceExpectedDue(serviceISO: string): string {
  return new Date(new Date(serviceISO).getTime() + GESTATION_DAYS * 86400000).toISOString().slice(0, 10);
}

describe('GOLDEN · retiro de carne (días)', () => {
  it.each([
    ['2026-07-01T10:00:00.000Z', 35, '2026-08-05'],
    ['2026-07-01T10:00:00.000Z', 28, '2026-07-29'],
    ['2026-02-15T00:00:00.000Z', 35, '2026-03-22'], // cruza fin de febrero (2026 no bisiesto)
  ])('applied %s + %i días → %s', (applied, days, expected) => {
    expect(referenceMeatWithdrawal(applied, days)).toBe(expected);
  });

  it('0 días o null → sin retiro (comportamiento actual)', () => {
    expect(referenceMeatWithdrawal('2026-07-01T10:00:00.000Z', 0)).toBeNull();
    expect(referenceMeatWithdrawal('2026-07-01T10:00:00.000Z', null)).toBeNull();
  });

  it('propiedad: el retiro cae exactamente N días después de la fecha de aplicación', () => {
    const applied = '2026-09-10T14:30:00.000Z';
    for (const days of [1, 7, 35, 120]) {
      const until = referenceMeatWithdrawal(applied, days)!;
      const diff = (Date.parse(`${until}T00:00:00.000Z`) - Date.parse('2026-09-10T00:00:00.000Z')) / 86400000;
      expect(diff).toBe(days);
    }
  });
});

describe('GOLDEN · retiro de leche (horas)', () => {
  it('96 h después conserva la hora del día (timestamp completo)', () => {
    expect(referenceMilkWithdrawal('2026-07-01T10:00:00.000Z', 96)).toBe('2026-07-05T10:00:00.000Z');
  });
  it('0 horas o null → sin retiro', () => {
    expect(referenceMilkWithdrawal('2026-07-01T10:00:00.000Z', 0)).toBeNull();
    expect(referenceMilkWithdrawal('2026-07-01T10:00:00.000Z', null)).toBeNull();
  });
});

describe('GOLDEN · gestación (fecha probable de parto)', () => {
  it.each([
    ['2026-06-02T08:00:00.000Z', '2027-03-12'], // confirmado en la app (vaca 126)
    ['2026-01-01T00:00:00.000Z', '2026-10-11'],
  ])('servicio %s + 283 días → %s', (service, expected) => {
    expect(referenceExpectedDue(service)).toBe(expected);
  });

  it('propiedad: son exactamente 283 días', () => {
    const service = '2026-05-20T00:00:00.000Z';
    const due = referenceExpectedDue(service);
    const diff = (Date.parse(`${due}T00:00:00.000Z`) - Date.parse('2026-05-20T00:00:00.000Z')) / 86400000;
    expect(diff).toBe(283);
  });
});
