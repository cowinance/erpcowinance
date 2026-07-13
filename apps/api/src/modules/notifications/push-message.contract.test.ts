import { describe, it, expect } from 'vitest';
import { buildPushMessageData, PUSH_DATA_VERSION, type PushMessageData } from './push-message.contract';

/**
 * Test de CONTRATO del payload push (F2.c). Fija la forma que consume el deep-link del cliente:
 * versión + notificationId + relatedType/relatedId (camelCase, null-safe), sin campos de más ni
 * lógica de navegación. Si esto cambia, hay que subir PUSH_DATA_VERSION y adaptar el cliente.
 */
describe('buildPushMessageData', () => {
  it('emite exactamente {v, notificationId, relatedType, relatedId}', () => {
    const data = buildPushMessageData({ id: 'n1', related_type: 'animal', related_id: 'a1' });
    expect(data).toEqual({ v: PUSH_DATA_VERSION, notificationId: 'n1', relatedType: 'animal', relatedId: 'a1' });
    // sin claves extra (contrato mínimo)
    expect(Object.keys(data).sort()).toEqual(['notificationId', 'relatedId', 'relatedType', 'v']);
  });

  it('versión estable = 1', () => {
    expect(PUSH_DATA_VERSION).toBe(1);
    expect(buildPushMessageData({ id: 'n1' }).v).toBe(1);
  });

  it('null-safe: sin related_* → relatedType/relatedId null; notificationId siempre presente', () => {
    expect(buildPushMessageData({ id: 'n2' })).toEqual({ v: 1, notificationId: 'n2', relatedType: null, relatedId: null });
    expect(buildPushMessageData({ id: 'n3', related_type: null, related_id: null })).toEqual({
      v: 1,
      notificationId: 'n3',
      relatedType: null,
      relatedId: null,
    });
  });

  it('task sin id de destino: relatedType=task, relatedId null (el cliente decide el fallback)', () => {
    const data: PushMessageData = buildPushMessageData({ id: 'n4', related_type: 'task', related_id: null });
    expect(data.relatedType).toBe('task');
    expect(data.relatedId).toBeNull();
  });
});
