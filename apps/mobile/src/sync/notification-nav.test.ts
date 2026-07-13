import { describe, it, expect } from 'vitest';
import { notificationHref } from './notification-nav';

/** Unit del deep-link cerrado del feed (P7-4.c.2). Mapa fijo; nada derivado de datos libres. */
describe('notificationHref', () => {
  it('caso 1: animal + id → /animal/:id', () => {
    expect(notificationHref({ related_type: 'animal', related_id: 'a1' })).toBe('/animal/a1');
  });
  it('caso 2: task → /tareas (sin requerir id)', () => {
    expect(notificationHref({ related_type: 'task', related_id: null })).toBe('/tareas');
  });
  it('caso 3: tipo desconocido → null', () => {
    expect(notificationHref({ related_type: 'weather', related_id: 'x' })).toBeNull();
    expect(notificationHref({ related_type: null, related_id: 'x' })).toBeNull();
  });
  it('caso 4: animal sin id → null', () => {
    expect(notificationHref({ related_type: 'animal', related_id: null })).toBeNull();
    expect(notificationHref({ related_type: 'animal', related_id: '' })).toBeNull();
  });
  it('caso 5: id con caracteres especiales se escapa', () => {
    expect(notificationHref({ related_type: 'animal', related_id: 'a/1 b#2' })).toBe(`/animal/${encodeURIComponent('a/1 b#2')}`);
  });
});
