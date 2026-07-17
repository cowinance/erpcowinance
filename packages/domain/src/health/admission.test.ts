import { describe, expect, it } from 'vitest';
import { assertAdmissionKind, InvalidAdmissionError, resolveAdmissionKind } from './admission';

describe('admission — tipo de internación vs propósito del lote (regla pura)', () => {
  it('infiere el tipo del propósito del lote cuando no viene explícito', () => {
    expect(resolveAdmissionKind('hospital')).toBe('hospital');
    expect(resolveAdmissionKind('quarantine')).toBe('quarantine');
  });

  it('acepta el tipo explícito si coincide con el propósito', () => {
    expect(resolveAdmissionKind('hospital', 'hospital')).toBe('hospital');
  });

  it('rechaza lote no admisible y tipo que no coincide', () => {
    expect(() => resolveAdmissionKind('breeding')).toThrow(InvalidAdmissionError);
    expect(() => resolveAdmissionKind('hospital', 'quarantine')).toThrow(InvalidAdmissionError);
  });

  it('valida el enum de tipo', () => {
    expect(assertAdmissionKind('quarantine')).toBe('quarantine');
    expect(() => assertAdmissionKind('icu')).toThrow(InvalidAdmissionError);
  });
});
