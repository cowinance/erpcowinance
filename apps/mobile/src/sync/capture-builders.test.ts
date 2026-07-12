import { describe, it, expect } from 'vitest';
import { buildMortalityEmit, buildWeaningEmit, buildNoteEmit } from './capture-builders';

/**
 * Unit de los builders puros del emit de captura (P5-2, D3-A). Fija el invariante Patrón B:
 * mortalidad y destete producen EXACTAMENTE un event op de su tabla de dominio, SIN
 * animal_events compañero ni puts; la nota produce un único animal_events event_type='note'.
 * Determinismo por inyección de `now` y `newId`.
 */
const NOW = new Date('2026-07-11T22:30:00.000Z');
const UUID = '11111111-2222-4333-8444-555555555555';
const newId = () => UUID;

describe('buildMortalityEmit', () => {
  it('un event op sobre mortalities; died_at = instante real; sin animal_events ni put', () => {
    const op = buildMortalityEmit('a1', 'timpanismo', NOW, newId);
    expect(op.table).toBe('mortalities');
    expect(op.rowId).toBe(UUID);
    expect(op.row).toEqual({ animal_id: 'a1', died_at: NOW.toISOString(), necropsy: false, estimated_loss: null, notes: 'timpanismo' });
    // No es un animal_events (Patrón B): el timeline lo autora el servidor.
    expect(op.table).not.toBe('animal_events');
  });

  it('notes=null cuando no se proporciona', () => {
    const op = buildMortalityEmit('a1', undefined, NOW, newId);
    expect(op.row.notes).toBeNull();
    expect(op.row.necropsy).toBe(false);
    expect(op.row.estimated_loss).toBeNull();
  });
});

describe('buildWeaningEmit', () => {
  it('un event op sobre weanings; weaning_date LOCAL YYYY-MM-DD; weight_kg preservado', () => {
    const op = buildWeaningEmit('a2', 185, NOW, newId);
    expect(op.table).toBe('weanings');
    expect(op.rowId).toBe(UUID);
    expect(op.row.animal_id).toBe('a2');
    expect(op.row.weight_kg).toBe(185);
    // Fecha local (no UTC): el día local de NOW, no depende del slice de timezone del server.
    const expected = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;
    expect(op.row.weaning_date).toBe(expected);
    expect(op.row.weaning_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('weight_kg AUSENTE (clave omitida) cuando no se proporciona', () => {
    const op = buildWeaningEmit('a2', undefined, NOW, newId);
    expect('weight_kg' in op.row).toBe(false);
    expect(op.row).toEqual({ animal_id: 'a2', weaning_date: op.row.weaning_date });
  });
});

describe('buildNoteEmit', () => {
  it('un event op animal_events event_type=note con payload {text} trim', () => {
    const op = buildNoteEmit('a3', '  revisar cojera  ', NOW, newId);
    expect(op).not.toBeNull();
    expect(op!.table).toBe('animal_events');
    expect(op!.rowId).toBe(UUID);
    expect(op!.row).toEqual({ animal_id: 'a3', event_type: 'note', payload: { text: 'revisar cojera' }, occurred_at: NOW.toISOString() });
  });

  it('nota vacía (o solo espacios) tras trim → null (no se emite)', () => {
    expect(buildNoteEmit('a3', '', NOW, newId)).toBeNull();
    expect(buildNoteEmit('a3', '   ', NOW, newId)).toBeNull();
    expect(buildNoteEmit('a3', '\n\t ', NOW, newId)).toBeNull();
  });
});

describe('rowId como identidad estable de la intención', () => {
  it('cada builder produce el rowId inyectado (idempotencia por rowId en los handlers)', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const gen = () => id;
    expect(buildMortalityEmit('x', undefined, NOW, gen).rowId).toBe(id);
    expect(buildWeaningEmit('x', 100, NOW, gen).rowId).toBe(id);
    expect(buildNoteEmit('x', 'hola', NOW, gen)!.rowId).toBe(id);
  });
});
