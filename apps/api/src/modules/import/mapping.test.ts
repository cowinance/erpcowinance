import { describe, it, expect } from 'vitest';
import { normalizeHeader, suggestMapping, DuplicateHeadersError } from './mapping';
import { ANIMAL_IMPORT_DESCRIPTOR } from '../herd/animal-import-descriptor';

/**
 * Normalización de encabezados + mapping sugerido (P2 oleada 3.3a). Puro.
 */

describe('normalizeHeader', () => {
  it('quita acentos, baja a minúsculas y recorta espacios de los bordes', () => {
    expect(normalizeHeader('  Categoría ')).toBe('categoria');
    expect(normalizeHeader('SEXO')).toBe('sexo');
    expect(normalizeHeader('Ñandú')).toBe('nandu');
  });

  it('colapsa espacios internos y preserva guiones bajos', () => {
    expect(normalizeHeader('Fecha   Nacimiento')).toBe('fecha nacimiento');
    expect(normalizeHeader('Fecha_Nacimiento')).toBe('fecha_nacimiento');
  });
});

describe('suggestMapping · coincidencias', () => {
  it('mapea por sinónimos con acentos/mayúsculas/espacios y preserva el encabezado ORIGINAL', () => {
    const m = suggestMapping(['Caravana', ' Sexo ', 'Categoría']);
    expect(m).toEqual({ tag: 'Caravana', sex: ' Sexo ', category_code: 'Categoría' });
  });

  it('mapea encabezados multi-palabra (fecha nacimiento) al campo correcto', () => {
    const m = suggestMapping(['RP', 'Fecha Nacimiento']);
    expect(m).toEqual({ tag: 'RP', birth_date: 'Fecha Nacimiento' });
  });
});

describe('suggestMapping · parcial y sin invención', () => {
  it('resultado PARCIAL: solo los campos con coincidencia', () => {
    const m = suggestMapping(['Caravana', 'Peso', 'Observaciones']);
    expect(m).toEqual({ tag: 'Caravana' }); // Peso/Observaciones no son campos del descriptor
  });

  it('encabezados sin sinónimo → ningún mapping inventado', () => {
    const m = suggestMapping(['zzz', 'columna rara']);
    expect(m).toEqual({});
  });

  it('nunca produce claves fuera del descriptor', () => {
    const valid = new Set(ANIMAL_IMPORT_DESCRIPTOR.fields.map((f) => f.field));
    const m = suggestMapping(['Caravana', 'Sexo', 'Categoria', 'Nombre', 'Origen', 'Fecha']);
    for (const k of Object.keys(m)) expect(valid.has(k as any)).toBe(true);
  });
});

describe('suggestMapping · determinismo', () => {
  it('varios encabezados que matchean el mismo campo → gana el PRIMERO (estable)', () => {
    expect(suggestMapping(['arete', 'caravana']).tag).toBe('arete');
    expect(suggestMapping(['caravana', 'arete']).tag).toBe('caravana');
  });
});

describe('suggestMapping · encabezados duplicados tras normalizar', () => {
  it('dos encabezados que normalizan igual → DuplicateHeadersError', () => {
    expect(() => suggestMapping(['Caravana', 'caravana'])).toThrow(DuplicateHeadersError);
    expect(() => suggestMapping(['Categoría', 'categoria '])).toThrow(DuplicateHeadersError);
  });

  it('el error lleva el código de dominio import.duplicate_headers', () => {
    try {
      suggestMapping(['Sexo', 'SEXO']);
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect((e as DuplicateHeadersError).code).toBe('import.duplicate_headers');
    }
  });

  it('encabezados distintos que matchean el MISMO campo NO son duplicados (normalizan distinto)', () => {
    expect(() => suggestMapping(['arete', 'caravana'])).not.toThrow();
  });
});

describe('suggestMapping · alineación con el descriptor', () => {
  it('cada sinónimo del descriptor mapea a su campo', () => {
    for (const field of ANIMAL_IMPORT_DESCRIPTOR.fields) {
      for (const syn of field.synonyms) {
        const m = suggestMapping([syn]);
        expect(m[field.field], `sinónimo '${syn}' → ${field.field}`).toBe(syn);
      }
    }
  });
});
