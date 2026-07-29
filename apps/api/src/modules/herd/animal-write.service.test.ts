import { describe, it, expect } from 'vitest';
import { AnimalWriteService, type RawAnimalRow } from './animal-write.service';

/** Un «hoy» fijo: la validación de fecha necesita saber qué es futuro, y un test no puede depender del reloj. */
const HOY_TEST = '2026-07-29';

/**
 * GOLDEN / CHARACTERIZATION — `normalizeAndValidate` (parte PURA de la
 * persistencia neutral de animal, D1). Pinea el contrato de validación
 * estructural que comparten REST (oleada 1) e Import (P2). No toca la base:
 * `db` no se usa en esta ruta, así que se instancia con un stub.
 */
// normalizeAndValidate es pura: las dependencias de sync no se usan en esta ruta.
const svc = new AnimalWriteService(undefined as any, undefined as any, undefined as any, undefined as any);
const base: RawAnimalRow = { tag: '1234', sex: 'F', category_code: 'cow' };

describe('normalizeAndValidate · happy path', () => {
  it('acepta input válido y normaliza (origin default "born")', () => {
    const r = svc.normalizeAndValidate(base, HOY_TEST);
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
    const r = svc.normalizeAndValidate({ ...base, tag: '  A-77  ' }, HOY_TEST);
    expect(r.ok && r.input.tag).toBe('A-77');
  });

  it('mapea campos opcionales (name, birth_date, lot_id, origin)', () => {
    const r = svc.normalizeAndValidate({
      ...base,
      name: 'Lola',
      birth_date: '2025-03-01',
      lot_id: 'lot-1',
      origin: 'purchased',
    }, HOY_TEST);
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
    const r = svc.normalizeAndValidate(raw, HOY_TEST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === field && e.code === 'required')).toBe(true);
  });

  it('caravana en blanco cuenta como ausente (required)', () => {
    const r = svc.normalizeAndValidate({ ...base, tag: '   ' }, HOY_TEST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'tag' && e.code === 'required')).toBe(true);
  });
});

describe('normalizeAndValidate · valores inválidos', () => {
  it('sexo fuera de {F,M} → invalid', () => {
    const r = svc.normalizeAndValidate({ ...base, sex: 'X' }, HOY_TEST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'sex' && e.code === 'invalid')).toBe(true);
  });

  it('acepta sexo M', () => {
    expect(svc.normalizeAndValidate({ ...base, sex: 'M' }, HOY_TEST).ok).toBe(true);
  });

  it('«H» DE HEMBRA ENTRA Y SE GUARDA COMO F', () => {
    // El bug medido: importar 3.000 animales creaba 1.500. Todas las filas de hembras se rechazaban
    // porque la planilla decía `H` y el importador exigía `F`. Se verifica el valor NORMALIZADO,
    // no solo que la fila pase: si entrara como 'H' rompería el CHECK de la base.
    const r = svc.normalizeAndValidate({ ...base, sex: 'H' }, HOY_TEST);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.sex).toBe('F');
  });

  it('acepta la palabra entera y no se distrae con mayúsculas', () => {
    for (const [escrito, guardado] of [['hembra', 'F'], ['Macho', 'M'], ['  h ', 'F']] as const) {
      const r = svc.normalizeAndValidate({ ...base, sex: escrito }, HOY_TEST);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.input.sex).toBe(guardado);
    }
  });

  it('una categoría en la columna de sexo sigue siendo un error', () => {
    // Adivinar «vaca» → F taparía una columna mal mapeada en vez de señalarla.
    expect(svc.normalizeAndValidate({ ...base, sex: 'vaca' }, HOY_TEST).ok).toBe(false);
  });

  it('origen fuera del enum → invalid', () => {
    const r = svc.normalizeAndValidate({ ...base, origin: 'cloned' }, HOY_TEST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'origin' && e.code === 'invalid')).toBe(true);
  });

  it('acumula múltiples errores', () => {
    const r = svc.normalizeAndValidate({}, HOY_TEST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('LA FECHA DE LA PLANILLA SE INTERPRETA ACÁ, que es por donde pasan las tres puertas', () => {
    // Antes el texto de la celda viajaba crudo hasta el `INSERT`: la vista previa decía «válida»
    // sobre cualquier cosa y el commit reventaba, matando el chunk entero. Esta etapa es pura y la
    // comparten la previa, el procesador y el alta por REST — cablearla acá es lo que hace que las
    // tres contesten lo mismo.
    const r = svc.normalizeAndValidate({ tag: 'A-1', sex: 'H', category_code: 'vaca', birth_date: '05/06/2022' }, HOY_TEST);
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.birthDate, 'día primero: 5 de junio, no 6 de mayo').toBe('2022-06-05');
  });

  it('una fecha que no es fecha se rechaza EN LA VALIDACIÓN, no en la base', () => {
    const r = svc.normalizeAndValidate({ tag: 'A-2', sex: 'H', category_code: 'vaca', birth_date: 'marzo 2022' }, HOY_TEST);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.field === 'birth_date')).toBe(true);
  });

  it('una fecha futura tampoco entra', () => {
    const r = svc.normalizeAndValidate({ tag: 'A-3', sex: 'H', category_code: 'vaca', birth_date: '2030-01-01' }, HOY_TEST);
    expect(r.ok).toBe(false);
  });

  it('sin fecha de nacimiento el animal entra igual', () => {
    // Comprar un animal sin ese dato es normal; bloquearlo sería peor que el problema.
    const r = svc.normalizeAndValidate({ tag: 'A-4', sex: 'H', category_code: 'vaca', birth_date: '' }, HOY_TEST);
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.birthDate).toBeNull();
  });
});
