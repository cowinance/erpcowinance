import { describe, it, expect } from 'vitest';
import {
  type CachedNotification,
  type NotificationCacheState,
  normalizeReadPending,
  addReadPending,
  hydrateCachedNotifications,
  sortByCreatedDesc,
  reconcileView,
  countUnread,
  classifyReadPost,
  prunePending,
  reduceRefresh,
} from './notification-cache';

/**
 * Unit de la capa pura del cache de notificaciones (P7-4.c.1). Fija los invariantes de la
 * reconciliación offline del ledger server-authored: vista única (snapshot + read-set),
 * poda por confirmación/404/estado-servidor, y no-destructividad ante fallos de red.
 * Determinismo por `nowIso` inyectado; sin I/O.
 */
function notif(over: Partial<CachedNotification> = {}): CachedNotification {
  return {
    id: 'n1',
    title: 'Retiro activo',
    body: null,
    status: 'delivered',
    read_at: null,
    created_at: '2026-07-11T10:00:00.000Z',
    alert_id: 'al1',
    related_type: 'animal',
    related_id: 'a1',
    ...over,
  };
}

describe('normalizeReadPending / addReadPending', () => {
  it('caso 3: deduplica y descarta ids vacíos o no-string', () => {
    expect(normalizeReadPending(['a', 'a', 'b', '', null as any, 1 as any, 'b'])).toEqual(['a', 'b']);
    expect(normalizeReadPending(undefined)).toEqual([]);
  });
  it('addReadPending agrega normalizando y no duplica', () => {
    expect(addReadPending(['a'], 'b')).toEqual(['a', 'b']);
    expect(addReadPending(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(addReadPending(['a'], '')).toEqual(['a']);
  });
});

describe('reconcileView / countUnread', () => {
  it('caso 1: snapshot no leído → contador 1', () => {
    const view = reconcileView([notif({ id: 'n1' })], []);
    expect(view).toHaveLength(1);
    expect(view[0].status).toBe('delivered');
    expect(countUnread(view)).toBe(1);
  });
  it('caso 2: id en read-set → se ve read y contador 0', () => {
    const view = reconcileView([notif({ id: 'n1' })], ['n1']);
    expect(view[0].status).toBe('read');
    expect(countUnread(view)).toBe(0);
  });
  it('caso 9: feed nuevo se ordena por created_at desc', () => {
    const view = reconcileView(
      [
        notif({ id: 'old', created_at: '2026-07-10T10:00:00.000Z' }),
        notif({ id: 'new', created_at: '2026-07-12T10:00:00.000Z' }),
        notif({ id: 'mid', created_at: '2026-07-11T10:00:00.000Z' }),
      ],
      [],
    );
    expect(view.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
  });
  it('caso 10: fecha inválida no rompe y ordena al final', () => {
    const view = reconcileView(
      [notif({ id: 'bad', created_at: 'no-es-fecha' }), notif({ id: 'ok', created_at: '2026-07-11T10:00:00.000Z' })],
      [],
    );
    expect(view.map((n) => n.id)).toEqual(['ok', 'bad']);
    expect(countUnread(view)).toBe(2);
  });
  it('reconcileView no muta el snapshot de entrada', () => {
    const snap = [notif({ id: 'n1', status: 'delivered' })];
    reconcileView(snap, ['n1']);
    expect(snap[0].status).toBe('delivered');
  });
});

describe('sortByCreatedDesc', () => {
  it('no muta el arreglo original', () => {
    const list = [notif({ id: 'a', created_at: '2026-07-10T00:00:00Z' }), notif({ id: 'b', created_at: '2026-07-11T00:00:00Z' })];
    const sorted = sortByCreatedDesc(list);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a']);
    expect(list.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('classifyReadPost', () => {
  it('2xx → confirmed; 404 → gone; red/otros → pending', () => {
    expect(classifyReadPost(200)).toBe('confirmed');
    expect(classifyReadPost(204)).toBe('confirmed');
    expect(classifyReadPost(404)).toBe('gone');
    expect(classifyReadPost(500)).toBe('pending');
    expect(classifyReadPost(null)).toBe('pending'); // error de red/timeout
    expect(classifyReadPost(undefined)).toBe('pending');
  });
});

describe('prunePending', () => {
  it('caso 5: POST confirmado poda el pendiente', () => {
    expect(prunePending({ pending: ['a', 'b'], resolved: ['a'], snapshot: [] })).toEqual(['b']);
  });
  it('caso 7: 404 (resuelto como gone) elimina el pendiente', () => {
    expect(prunePending({ pending: ['a', 'b'], resolved: ['b'], snapshot: [] })).toEqual(['a']);
  });
  it('caso 4: snapshot server=read poda el pendiente', () => {
    const snap = [notif({ id: 'a', status: 'read' }), notif({ id: 'b', status: 'delivered' })];
    expect(prunePending({ pending: ['a', 'b'], resolved: [], snapshot: snap })).toEqual(['b']);
  });
  it('caso 6: sin confirmación ni read en server, conserva el pendiente', () => {
    const snap = [notif({ id: 'a', status: 'delivered' })];
    expect(prunePending({ pending: ['a'], resolved: [], snapshot: snap })).toEqual(['a']);
  });
});

describe('reduceRefresh', () => {
  const base: NotificationCacheState = {
    notifications: [notif({ id: 'a', status: 'delivered', created_at: '2026-07-11T10:00:00Z' })],
    notificationsAt: '2026-07-11T09:00:00.000Z',
    notificationReadPending: ['a'],
  };

  it('caso 5: feed nuevo con a=read + POST confirmado → snapshot y timestamp nuevos, pendiente podado', () => {
    const next = reduceRefresh(base, {
      postedResolved: ['a'],
      snapshot: [notif({ id: 'a', status: 'read' }), notif({ id: 'b', status: 'delivered' })],
      nowIso: '2026-07-12T00:00:00.000Z',
    });
    expect(next.notificationsAt).toBe('2026-07-12T00:00:00.000Z');
    expect(next.notifications.map((n) => n.id)).toEqual(['a', 'b']);
    expect(next.notificationReadPending).toEqual([]);
  });

  it('caso 8: refresh fallido (snapshot null) conserva snapshot, timestamp y pendiente previos', () => {
    const next = reduceRefresh(base, { postedResolved: [], snapshot: null, nowIso: '2026-07-12T00:00:00.000Z' });
    expect(next.notifications).toEqual(base.notifications);
    expect(next.notificationsAt).toBe('2026-07-11T09:00:00.000Z');
    expect(next.notificationReadPending).toEqual(['a']);
  });

  it('caso 6: GET ok pero server aún delivered y POST no confirmado → conserva el pendiente', () => {
    const next = reduceRefresh(base, {
      postedResolved: [],
      snapshot: [notif({ id: 'a', status: 'delivered' })],
      nowIso: '2026-07-12T00:00:00.000Z',
    });
    expect(next.notificationReadPending).toEqual(['a']);
  });

  it('caso 8-bis: snapshot null nunca sustituye el cache por []', () => {
    const next = reduceRefresh(base, { postedResolved: [], snapshot: null, nowIso: '2026-07-12T00:00:00.000Z' });
    expect(next.notifications.length).toBeGreaterThan(0);
  });

  it('caso 11: dos refresh consecutivos no pierden un pendiente agregado entre medio', () => {
    // 1er refresh confirma 'a'. Entremedio el usuario marca 'b' (addReadPending).
    const after1 = reduceRefresh(base, { postedResolved: ['a'], snapshot: [notif({ id: 'a', status: 'read' })], nowIso: '2026-07-12T00:00:00Z' });
    expect(after1.notificationReadPending).toEqual([]);
    const withB: NotificationCacheState = { ...after1, notificationReadPending: addReadPending(after1.notificationReadPending, 'b') };
    // 2do refresh: 'b' aún no confirmado ni read en server → se conserva.
    const after2 = reduceRefresh(withB, { postedResolved: [], snapshot: [notif({ id: 'a', status: 'read' }), notif({ id: 'b', status: 'delivered' })], nowIso: '2026-07-12T01:00:00Z' });
    expect(after2.notificationReadPending).toEqual(['b']);
  });

  it('caso 12: entradas degeneradas no lanzan (el cache es best-effort, nunca aborta el sync)', () => {
    const empty: NotificationCacheState = { notifications: [], notificationReadPending: [] };
    expect(() => reduceRefresh(empty, { postedResolved: [], snapshot: null, nowIso: 'x' })).not.toThrow();
    expect(() => reduceRefresh(empty, { postedResolved: [], snapshot: [], nowIso: 'x' })).not.toThrow();
  });
});

describe('hydrateCachedNotifications (tolerante y acotado al feed in_app)', () => {
  it('descarta ítems sin id y no-objetos', () => {
    const out = hydrateCachedNotifications([notif({ id: 'ok' }), { id: '' }, null, 42, { title: 'sin id' }]);
    expect(out.map((n) => n.id)).toEqual(['ok']);
  });
  it('tolera campos ausentes y status desconocido (→ delivered); ignora campos internos del transporte', () => {
    const out = hydrateCachedNotifications([
      { id: 'x', status: 'queued', push_token: 'ExponentPushToken[..]', delivery_id: 'd1', channel: 'push' } as any,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('delivered'); // 'queued' no es un estado del feed in_app
    expect(out[0]).not.toHaveProperty('push_token');
    expect(out[0]).not.toHaveProperty('delivery_id');
    expect(out[0]).not.toHaveProperty('channel');
    expect(out[0].body).toBeNull();
    expect(out[0].created_at).toBe('');
  });
  it('no-arreglo → []', () => {
    expect(hydrateCachedNotifications(null)).toEqual([]);
    expect(hydrateCachedNotifications({} as any)).toEqual([]);
  });
});
