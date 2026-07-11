import { describe, it, expect } from 'vitest';
import { ANIMAL_IMPORT_DESCRIPTOR, REQUIRED_ANIMAL_IMPORT_FIELDS } from './animal-import-descriptor';

/**
 * Integridad del descriptor de importación de animal (P2 oleada 3.2). Pura.
 * Consumido por ImportModule (3.3) para mapping sugerido y por preview (3.5).
 */

describe('ANIMAL_IMPORT_DESCRIPTOR', () => {
  it('es del tipo de entidad animal', () => {
    expect(ANIMAL_IMPORT_DESCRIPTOR.entityType).toBe('animal');
  });

  it('los obligatorios son exactamente tag, sex y category_code', () => {
    expect([...REQUIRED_ANIMAL_IMPORT_FIELDS].sort()).toEqual(['category_code', 'sex', 'tag']);
  });

  it('cada campo tiene al menos un sinónimo', () => {
    for (const f of ANIMAL_IMPORT_DESCRIPTOR.fields) {
      expect(f.synonyms.length, `campo ${f.field}`).toBeGreaterThan(0);
    }
  });

  it('los sinónimos están normalizados (minúsculas, sin espacios en los bordes) y sin acentos', () => {
    for (const f of ANIMAL_IMPORT_DESCRIPTOR.fields) {
      for (const s of f.synonyms) {
        expect(s, `sinónimo '${s}' de ${f.field}`).toBe(s.trim().toLowerCase());
        expect(/[áéíóúñ]/.test(s), `sinónimo '${s}' con acento`).toBe(false);
      }
    }
  });

  it('no hay nombres de campo duplicados', () => {
    const names = ANIMAL_IMPORT_DESCRIPTOR.fields.map((f) => f.field);
    expect(new Set(names).size).toBe(names.length);
  });

  it('ningún sinónimo pertenece a dos campos distintos (auto-mapping determinista)', () => {
    const seen = new Map<string, string>();
    for (const f of ANIMAL_IMPORT_DESCRIPTOR.fields) {
      for (const s of f.synonyms) {
        expect(seen.has(s), `sinónimo '${s}' compartido entre ${seen.get(s)} y ${f.field}`).toBe(false);
        seen.set(s, f.field);
      }
    }
  });
});
