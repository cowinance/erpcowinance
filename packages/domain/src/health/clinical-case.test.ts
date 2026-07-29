import { describe, expect, it } from 'vitest';
import {
  CLINICAL_CASE_STATUSES,
  isTerminalCaseStatus,
  assertCaseAcceptsActivity,
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

describe('un caso terminado no admite más actividad', () => {
  it('«cerrado» es el único estado del que no se sale', () => {
    // Se DERIVA de la tabla de transiciones, no de una lista aparte: si mañana `closed` dejara de
    // ser terminal, esto lo sigue solo. Y deja explícito qué NO es terminal, que es la mitad que se
    // olvida.
    const terminales = CLINICAL_CASE_STATUSES.filter(isTerminalCaseStatus);
    expect(terminales).toEqual(['closed']);
  });

  it('«murió» NO es terminal, a propósito', () => {
    // El resultado de una necropsia llega después de la muerte y tiene que poder anotarse. Bloquear
    // acá perdería justo el dato que explica por qué se murió.
    expect(isTerminalCaseStatus('died')).toBe(false);
    expect(() => assertCaseAcceptsActivity('died')).not.toThrow();
  });

  it('cerrado rechaza, y el mensaje dice qué hacer', () => {
    // «No se puede» a secas deja al productor sin salida. La recaída de un animal ya recuperado se
    // maneja con un caso nuevo, y eso es lo que hay que decirle.
    try {
      assertCaseAcceptsActivity('closed');
      throw new Error('debería haber fallado');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidClinicalCaseError);
      const err = e as InvalidClinicalCaseError;
      expect(err.code).toBe('clinical_case.closed');
      expect(err.reason).toMatch(/caso nuevo/);
    }
  });

  it('los estados en curso pasan sin ruido', () => {
    for (const s of ['open', 'in_treatment', 'observation', 'recovered', 'referred'] as const)
      expect(() => assertCaseAcceptsActivity(s), s).not.toThrow();
  });
});
