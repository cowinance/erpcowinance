import { describe, it, expect } from 'vitest';
import { newbornCategoryCode } from './newborn-category';

describe('newbornCategoryCode · categoría de una cría al nacer, según sexo', () => {
  it("'M' → ternero", () => {
    expect(newbornCategoryCode('M')).toBe('ternero');
  });

  it("'F' → ternera", () => {
    expect(newbornCategoryCode('F')).toBe('ternera');
  });

  it('comportamiento actual preservado: cualquier valor que no sea exactamente M cae en ternera', () => {
    expect(newbornCategoryCode(undefined)).toBe('ternera');
    expect(newbornCategoryCode(null)).toBe('ternera');
    expect(newbornCategoryCode('')).toBe('ternera');
    expect(newbornCategoryCode('m')).toBe('ternera'); // minúscula: no es 'M' exacto, hoy cae en hembra
  });
});
