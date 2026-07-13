import { describe, it, expect } from 'vitest';
import { resolvePushDestination, SUPPORTED_PUSH_DATA_VERSION } from './deep-link';

/**
 * Unit del resolver único de destino del push (F2.b). Fija: reutiliza notificationHref, valida el
 * contrato (F2.c) y SIEMPRE cae a /notificaciones ante payload inválido/incompleto/no soportado.
 */
const V = SUPPORTED_PUSH_DATA_VERSION;

describe('resolvePushDestination', () => {
  it('animal + id válido → /animal/:id', () => {
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 'animal', relatedId: 'a1' })).toBe('/animal/a1');
  });
  it('task → /tareas', () => {
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 'task', relatedId: null })).toBe('/tareas');
  });
  it('versión distinta → fallback /notificaciones', () => {
    expect(resolvePushDestination({ v: 999, notificationId: 'n1', relatedType: 'animal', relatedId: 'a1' })).toBe('/notificaciones');
  });
  it('sin notificationId → fallback', () => {
    expect(resolvePushDestination({ v: V, relatedType: 'animal', relatedId: 'a1' })).toBe('/notificaciones');
    expect(resolvePushDestination({ v: V, notificationId: '', relatedType: 'animal', relatedId: 'a1' })).toBe('/notificaciones');
  });
  it('relatedType no soportado → fallback', () => {
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 'weather', relatedId: 'x' })).toBe('/notificaciones');
  });
  it('animal sin id → fallback (notificationHref da null)', () => {
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 'animal', relatedId: null })).toBe('/notificaciones');
  });
  it('no-objeto / null / campos de tipo inválido → fallback', () => {
    expect(resolvePushDestination(null)).toBe('/notificaciones');
    expect(resolvePushDestination('x')).toBe('/notificaciones');
    expect(resolvePushDestination(42)).toBe('/notificaciones');
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 5, relatedId: {} })).toBe('/notificaciones');
  });
  it('id con caracteres especiales se escapa (vía notificationHref)', () => {
    expect(resolvePushDestination({ v: V, notificationId: 'n1', relatedType: 'animal', relatedId: 'a/1' })).toBe(`/animal/${encodeURIComponent('a/1')}`);
  });
});
