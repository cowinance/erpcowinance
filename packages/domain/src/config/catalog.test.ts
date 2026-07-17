import { describe, expect, it } from 'vitest';
import { InvalidCatalogEntryError, assertBreedPurpose, assertUnitSystem, normalizeCatalogCode, normalizeCurrencyCode, validateBreedInput, validateDiagnosisInput } from './catalog';

describe('assertUnitSystem', () => {
  it('acepta metric/imperial y rechaza el resto', () => {
    expect(assertUnitSystem('metric')).toBe('metric');
    expect(assertUnitSystem('imperial')).toBe('imperial');
    expect(() => assertUnitSystem('metrico')).toThrow(InvalidCatalogEntryError);
    expect(() => assertUnitSystem('')).toThrow(InvalidCatalogEntryError);
  });
});

describe('normalizeCurrencyCode', () => {
  it('normaliza a mayúsculas y exige 3 letras ISO 4217', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD');
    expect(normalizeCurrencyCode(' ars ')).toBe('ARS');
    expect(() => normalizeCurrencyCode('US')).toThrow(InvalidCatalogEntryError);
    expect(() => normalizeCurrencyCode('US1')).toThrow(InvalidCatalogEntryError);
    expect(() => normalizeCurrencyCode('')).toThrow(InvalidCatalogEntryError);
  });
});

describe('normalizeCatalogCode', () => {
  it('recorta y exige no vacío', () => {
    expect(normalizeCatalogCode('  AN  ')).toBe('AN');
    expect(() => normalizeCatalogCode('   ')).toThrow(InvalidCatalogEntryError);
    expect(() => normalizeCatalogCode(undefined)).toThrow(InvalidCatalogEntryError);
  });
  it('rechaza códigos demasiado largos', () => {
    expect(() => normalizeCatalogCode('x'.repeat(65))).toThrow(InvalidCatalogEntryError);
  });
});

describe('assertBreedPurpose', () => {
  it('acepta enum o vacío, rechaza inválido', () => {
    expect(assertBreedPurpose('beef')).toBe('beef');
    expect(assertBreedPurpose('')).toBeNull();
    expect(assertBreedPurpose(null)).toBeNull();
    expect(() => assertBreedPurpose('carne')).toThrow(InvalidCatalogEntryError);
  });
});

describe('validateBreedInput', () => {
  it('normaliza una raza válida', () => {
    expect(validateBreedInput({ code: ' AN ', name: ' Angus ', purpose: 'beef' })).toEqual({ code: 'AN', name: 'Angus', purpose: 'beef' });
  });
  it('exige código y nombre', () => {
    expect(() => validateBreedInput({ code: '', name: 'X' })).toThrow(InvalidCatalogEntryError);
    expect(() => validateBreedInput({ code: 'X', name: '' })).toThrow(InvalidCatalogEntryError);
  });
});

describe('validateDiagnosisInput', () => {
  it('normaliza; categoría vacía → null; is_notifiable coacciona a boolean', () => {
    expect(validateDiagnosisInput({ code: 'BRUC', name: 'Brucelosis', category: '  ', is_notifiable: 1 })).toEqual({ code: 'BRUC', name: 'Brucelosis', category: null, isNotifiable: true });
    expect(validateDiagnosisInput({ code: 'X', name: 'Y', category: 'repro' }).category).toBe('repro');
  });
});
