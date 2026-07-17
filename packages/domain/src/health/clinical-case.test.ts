import { describe, expect, it } from 'vitest';
import {
  assertCaseOutcome,
  assertCaseSeverity,
  assertCaseStatus,
  assertCaseTransition,
  InvalidClinicalCaseError,
  isOpenCaseStatus,
} from './clinical-case';

describe('clinical-case — máquina de estados (regla pura)', () => {
  it('acepta transiciones válidas', () => {
    expect(() => assertCaseTransition('open', 'in_treatment')).not.toThrow();
    expect(() => assertCaseTransition('in_treatment', 'recovered')).not.toThrow();
    expect(() => assertCaseTransition('observation', 'closed')).not.toThrow();
    expect(() => assertCaseTransition('open', 'open')).not.toThrow(); // idempotente
  });

  it('rechaza transiciones inválidas y desde estados terminales', () => {
    expect(() => assertCaseTransition('closed', 'open')).toThrow(InvalidClinicalCaseError);
    expect(() => assertCaseTransition('died', 'in_treatment')).toThrow(InvalidClinicalCaseError);
  });

  it('valida estado, severidad y resultado del catálogo', () => {
    expect(assertCaseStatus('observation')).toBe('observation');
    expect(() => assertCaseStatus('zzz')).toThrow(InvalidClinicalCaseError);
    expect(assertCaseSeverity('')).toBeNull();
    expect(assertCaseSeverity('severe')).toBe('severe');
    expect(() => assertCaseSeverity('critical')).toThrow(InvalidClinicalCaseError);
    expect(assertCaseOutcome('recovered')).toBe('recovered');
    expect(() => assertCaseOutcome('healed')).toThrow(InvalidClinicalCaseError);
  });

  it('clasifica estados abiertos', () => {
    expect(isOpenCaseStatus('in_treatment')).toBe(true);
    expect(isOpenCaseStatus('closed')).toBe(false);
    expect(isOpenCaseStatus('recovered')).toBe(false);
  });
});
