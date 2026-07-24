import { describe, it, expect } from 'vitest';
import { AnimalWriteService, type RawAnimalRow } from './animal-write.service';

/**
 * GOLDEN / CHARACTERIZATION — `normalizeAndValidate` (parte PURA de la
 * persistencia neutral de animal, D1). Pinea el contrato de validación
 * estructural que comparten REST (oleada 1) e Import (P2). No toca la base:
 * `db` no se usa en esta ruta, así que se instancia con un stub.
 */
// normalizeAndValidate es pura: las dependencias de sync no se usan en esta ruta.
const svc = new AnimalWriteService(undefined as any, undefined as any, undefined as any);
const base: RawAnimalRow = { tag: '1234', sex: 'F', category_code: 'cow' };

describe('normalizeAndValidate · happy path', () => {
  it('acepta input válido y normaliza (origin default "born")', () => {
    const r = svc.normalizeAndValidate(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toEqual({
        tag: '1234',
        sex: 'F',
        categoryCode: 'cow',
        name: null,
        birthDate: null,
        lotId: null,
        origin: 'born',
        // Campos de importación (Fase 3c): opcionales, ausentes → null.
        breedName: null,
        lotName: null,
        rfid: null,
        officialId: null,
      });
    }
  });

  it('normaliza la caravana (TagNumber: recorta espacios sobrantes)', () => {
    const r = svc.normalizeAndValidate({ ...base, tag: '  A-77  ' });
    expect(r.ok && r.input.tag).toBe('A-77');
  });

  it('mapea campos opcionales (name, birth_date, lot_id, origin)', () => {
    const r = svc.normalizeAndValidate({
      ...base,
      name: 'Lola',
      birth_date: '2025-03-01',
      lot_id: 'lot-1',
      origin: 'purchased',
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.input).toMatchObject({ name: 'Lola', birthDate: '2025-03-01', lotId: 'lot-1', origin: 'purchased' });
  });
});

describe('normalizeAndValidate · campos obligatorios', () => {
  it.each([
    ['tag', { sex: 'F', category_code: 'cow' }],
    ['sex', { tag: '1', category_code: 'cow' }],
    ['category_code', { tag: '1', sex: 'F' }],
  ] as [string, RawAnimalRow][])('falta %s → error required', (field, raw) => {
    const r = svc.normalizeAndValidate(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === field && e.code === 'required')).toBe(true);
  });

  it('caravana en blanco cuenta como ausente (required)', () => {
    const r = svc.normalizeAndValidate({ ...base, tag: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'tag' && e.code === 'required')).toBe(true);
  });
});

describe('normalizeAndValidate · valores inválidos', () => {
  it('sexo fuera de {F,M} → invalid', () => {
    const r = svc.normalizeAndValidate({ ...base, sex: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'sex' && e.code === 'invalid')).toBe(true);
  });

  it('acepta sexo M', () => {
    expect(svc.normalizeAndValidate({ ...base, sex: 'M' }).ok).toBe(true);
  });

  it('origen fuera del enum → invalid', () => {
    const r = svc.normalizeAndValidate({ ...base, origin: 'cloned' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'origin' && e.code === 'invalid')).toBe(true);
  });

  it('acumula múltiples errores', () => {
    const r = svc.normalizeAndValidate({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
