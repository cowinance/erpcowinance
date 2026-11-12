import { useCallback, useRef } from 'react';
import type { PersistedMeta } from './storage.types';
import {
  type CachedNotification,
  type NotificationCacheState,
  addReadPending,
  classifyReadPost,
  hydrateCachedNotifications,
  normalizeReadPending,
  prunePending,
  reduceRefresh,
} from './notification-cache';

/**
 * El feed de notificaciones del móvil: traerlo, cachearlo y marcar leídas.
 *
 * Sale de `SyncContext` porque no es sincronización: no pasa por el motor CRDT, no tiene cola de
 * cambios y su fallo no puede afectar al push/pull. Es cache-on-sync best-effort, y mantenerlo
 * aparte deja eso explícito en vez de confiado a los comentarios.
 */
export interface Notificaciones {
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  syncPushToken: (token: string) => Promise<void>;
  scheduleNotificationsRefresh: () => void;
}

export function useNotificaciones({
  authFetch,
  persistMeta,
  metaRef,
  offlineRef,
  bump,
  debounceMs,
}: {
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  persistMeta: (mutate: (prev: PersistedMeta) => PersistedMeta) => Promise<void>;
  metaRef: { current: PersistedMeta | null };
  offlineRef: { current: boolean };
  bump: () => void;
  debounceMs: number;
}): Notificaciones {
  const notifRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  /**
   * Cache-on-sync del feed in_app (P7-4.c), best-effort e independiente del sync CRDT. Orden (D4):
   * 1) flush de POST /read pendientes; 2) GET /notifications; 3) reduce + persist. Un fallo de red
   * conserva snapshot, timestamp y read-set previos; nunca sustituye el cache por []. Reutilizable
   * por syncNow y por la pantalla al enfocarse.
   */
  const refreshNotifications = useCallback(async () => {
    if (!metaRef.current) return;
    try {
      const pending = normalizeReadPending(metaRef.current.notificationReadPending);
      const resolved: string[] = [];
      for (const id of pending) {
        try {
          const r = await authFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
          const c = classifyReadPost(r.status);
          if (c === 'confirmed' || c === 'gone') resolved.push(id); // 404 → ya inaccesible, no reintentar
        } catch {
          /* red/timeout: se conserva el pendiente, se reconcilia en el próximo sync */
        }
      }
      let snapshot: CachedNotification[] | null = null;
      try {
        const r = await authFetch('/notifications');
        if (r.ok) snapshot = hydrateCachedNotifications(await r.json());
      } catch {
        /* red: se mantiene el snapshot previo */
      }
      const nowIso = new Date().toISOString();
      await persistMeta((prev) => {
        const prevState: NotificationCacheState = {
          notifications: prev.notifications ?? [],
          notificationsAt: prev.notificationsAt,
          notificationReadPending: normalizeReadPending(prev.notificationReadPending),
        };
        const next = reduceRefresh(prevState, { postedResolved: resolved, snapshot, nowIso });
        return { ...prev, notifications: next.notifications, notificationsAt: next.notificationsAt, notificationReadPending: next.notificationReadPending };
      });
      bump();
    } catch {
      /* el cache es best-effort: ningún fallo aquí aborta ni ensucia el sync principal */
    }
  }, [authFetch, persistMeta, metaRef, bump]);

  /**
   * Sincroniza el token Expo con el servidor (P7 F2.a): POST /sync/devices/:id/push-token +
   * persiste `lastPushToken` (optimización local de idempotencia). No prompta permisos ni toca
   * el SO — eso vive en la capa nativa; acá solo la parte autenticada/persistente.
   */
  const syncPushToken = useCallback(
    async (token: string) => {
      const deviceId = metaRef.current?.serverDeviceId;
      if (!deviceId || !token) return;
      const res = await authFetch(`/sync/devices/${deviceId}/push-token`, { method: 'POST', body: JSON.stringify({ push_token: token }) });
      if (!res.ok) throw new Error(`push-token → ${res.status}`);
      await persistMeta((prev) => ({ ...prev, lastPushToken: token }));
      bump();
    },
    [authFetch, persistMeta, metaRef, bump],
  );

  /**
   * Marca una notificación como leída (P7-4.c): 1) read-set local + persist inmediatos (badge baja
   * al instante); 2) POST /read best-effort; si confirma o 404, poda el pendiente. NO navega (eso
   * es la pantalla, c.2) ni bloquea por estar offline: la intención queda en la cola local.
   */
  const markNotificationRead = useCallback(
    async (id: string) => {
      if (!id) return;
      await persistMeta((prev) => ({ ...prev, notificationReadPending: addReadPending(prev.notificationReadPending, id) }));
      bump();
      try {
        const r = await authFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
        const c = classifyReadPost(r.status);
        if (c === 'confirmed' || c === 'gone') {
          await persistMeta((prev) => ({
            ...prev,
            notificationReadPending: prunePending({ pending: prev.notificationReadPending, resolved: [id], snapshot: prev.notifications ?? [] }),
          }));
        }
      } catch {
        /* red: se conserva el pendiente para el próximo refresh */
      }
    },
    [authFetch, persistMeta, bump],
  );

  /**
   * Refresh del feed in_app con anti-ráfaga (P7 F2.b): coalesce una ráfaga de pushes en un solo
   * refresh (debounce trailing, mismo patrón que scheduleSync), en vez de disparar N refrescos.
   * No fuerza un sync CRDT completo.
   */
  const scheduleNotificationsRefresh = useCallback(() => {
    if (notifRefreshDebounceRef.current) clearTimeout(notifRefreshDebounceRef.current);
    notifRefreshDebounceRef.current = setTimeout(() => {
      if (!offlineRef.current) refreshNotifications();
    }, debounceMs);
  }, [refreshNotifications, offlineRef, debounceMs]);

  return { refreshNotifications, markNotificationRead, syncPushToken, scheduleNotificationsRefresh };
}
