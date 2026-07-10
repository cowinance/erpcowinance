import { describe, it, expect } from 'vitest';
import {
  computeWithdrawal,
  computeExpectedDueDateFromService,
  computeExpectedDueDateFromDiagnosis,
} from '@cowinance/domain';

/**
 * GOLDEN / CHARACTERIZATION TESTS — Fase 0 (red de seguridad).
 *
 * Pinean el comportamiento de las reglas de negocio que la Fase 4 extrajo a
 * `packages/domain` (antes duplicadas en health.service.ts, repro.service.ts
 * y apps/mobile/SyncContext.tsx). Todas las `reference*` de abajo MIGRADAS:
 * delegan en la función real del dominio. Que esta MISMA tabla de valores
 * siga pasando es la prueba de que la extracción no cambió comportamiento.
 */

/** health.service.ts (antes) / packages/domain/health/withdrawal.ts (F4.1). */
function referenceMeatWithdrawal(appliedAtISO: string, days: number | null): string | null {
  return computeWithdrawal(new Date(appliedAtISO), days, null).meatWithdrawalUntil;
}

/** health.service.ts (antes) / packages/domain/health/withdrawal.ts (F4.1). */
function referenceMilkWithdrawal(appliedAtISO: string, hours: number | null): string | null {
  return computeWithdrawal(new Date(appliedAtISO), null, hours).milkWithdrawalUntil;
}

/** repro.service.ts, Modo A (antes) / packages/domain/reproduction/gestation.ts (F4.2). */
function referenceExpectedDue(serviceISO: string): string {
  return computeExpectedDueDateFromService(new Date(serviceISO));
}

/** repro.service.ts, Modo B (antes) / packages/domain/reproduction/gestation.ts (F4.2). */
function referenceExpectedDueFromDiagnosis(diagnosisISO: string): string {
  return computeExpectedDueDateFromDiagnosis(new Date(diagnosisISO));
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

describe('GOLDEN · gestación, Modo A (fecha probable de parto desde servicio)', () => {
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

describe('GOLDEN · gestación, Modo B (fecha probable de parto desde diagnóstico sin servicio conocido)', () => {
  it.each([
    ['2026-06-02T00:00:00.000Z', '2027-01-26'],
    ['2026-01-01T00:00:00.000Z', '2026-08-27'],
    ['2026-11-20T00:00:00.000Z', '2027-07-16'],
  ])('diagnóstico %s + 238 días (283 − 45) → %s', (diagnosis, expected) => {
    expect(referenceExpectedDueFromDiagnosis(diagnosis)).toBe(expected);
  });

  it('propiedad: son exactamente 238 días (283 − 45)', () => {
    const diagnosis = '2026-05-20T00:00:00.000Z';
    const due = referenceExpectedDueFromDiagnosis(diagnosis);
    const diff = (Date.parse(`${due}T00:00:00.000Z`) - Date.parse('2026-05-20T00:00:00.000Z')) / 86400000;
    expect(diff).toBe(238);
  });

  it('Modo A y Modo B difieren en exactamente 45 días para la misma fecha de entrada', () => {
    const date = '2026-05-20T00:00:00.000Z';
    const dueA = referenceExpectedDue(date);
    const dueB = referenceExpectedDueFromDiagnosis(date);
    const diff = (Date.parse(`${dueA}T00:00:00.000Z`) - Date.parse(`${dueB}T00:00:00.000Z`)) / 86400000;
    expect(diff).toBe(45);
  });
});
