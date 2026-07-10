import { describe, it, expect } from 'vitest';
import { computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis } from './gestation';

/**
 * Misma tabla de valores que el oráculo golden (F0 + gap Modo B cerrado
 * antes de F4.2): apps/api/test/business-rules.golden.test.ts.
 */
describe('computeExpectedDueDateFromService · Modo A (desde servicio conocido)', () => {
  it.each([
    ['2026-06-02T08:00:00.000Z', '2027-03-12'],
    ['2026-01-01T00:00:00.000Z', '2026-10-11'],
  ])('servicio %s + 283 días → %s', (service, expected) => {
    expect(computeExpectedDueDateFromService(new Date(service))).toBe(expected);
  });

  it('propiedad: son exactamente 283 días', () => {
    const service = new Date('2026-05-20T00:00:00.000Z');
    const due = computeExpectedDueDateFromService(service);
    const diff = (Date.parse(`${due}T00:00:00.000Z`) - service.getTime()) / 86400000;
    expect(diff).toBe(283);
  });
});

describe('computeExpectedDueDateFromDiagnosis · Modo B (sin servicio conocido)', () => {
  it.each([
    ['2026-06-02T00:00:00.000Z', '2027-01-26'],
    ['2026-01-01T00:00:00.000Z', '2026-08-27'],
    ['2026-11-20T00:00:00.000Z', '2027-07-16'],
  ])('diagnóstico %s + 238 días (283 − 45) → %s', (diagnosis, expected) => {
    expect(computeExpectedDueDateFromDiagnosis(new Date(diagnosis))).toBe(expected);
  });

  it('propiedad: son exactamente 238 días (283 − 45)', () => {
    const diagnosis = new Date('2026-05-20T00:00:00.000Z');
    const due = computeExpectedDueDateFromDiagnosis(diagnosis);
    const diff = (Date.parse(`${due}T00:00:00.000Z`) - diagnosis.getTime()) / 86400000;
    expect(diff).toBe(238);
  });
});

describe('los dos modos son funciones distintas, no una rama oculta', () => {
  it('para la misma fecha de entrada, Modo A y Modo B difieren en exactamente 45 días', () => {
    const date = '2026-05-20T00:00:00.000Z';
    const dueA = computeExpectedDueDateFromService(new Date(date));
    const dueB = computeExpectedDueDateFromDiagnosis(new Date(date));
    const diff = (Date.parse(`${dueA}T00:00:00.000Z`) - Date.parse(`${dueB}T00:00:00.000Z`)) / 86400000;
    expect(diff).toBe(45);
  });
});
