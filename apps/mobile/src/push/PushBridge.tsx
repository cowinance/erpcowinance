/**
 * Wiring raíz del push en el dispositivo (P7 F2.b). Sin UI (devuelve null). Monta el handler de
 * foreground, los listeners de recepción/tap/rotación (con desmontaje) y la reconciliación en boot.
 * Toda la lógica de destino se centraliza en `resolvePushDestination`; el estado del token vive en
 * SyncContext (fuente de verdad reconciliable). Seguro aunque el push esté inactivo: los helpers
 * nativos no piden permiso por sí solos (el prompt sigue siendo la acción del Menú, F2.a).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { router, type Href } from 'expo-router';
import { useSync } from '@/sync/SyncContext';
import {
  addReceivedListener,
  addResponseListener,
  configureForegroundHandler,
  getInitialResponse,
  reconcilePush,
  subscribeTokenRotation,
  type PushSyncBridge,
} from './native';
import { resolvePushDestination } from './deep-link';

export function PushBridge() {
  const sync = useSync();
  // Ref siempre-actual: evita re-montar efectos por el nuevo objeto de contexto en cada render.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const deviceId = sync.serverDeviceId;

  const bridge = useMemo<PushSyncBridge>(
    () => ({
      hasServerDevice: () => !!syncRef.current.serverDeviceId,
      lastSyncedToken: () => syncRef.current.pushLastToken,
      syncToken: (t: string) => syncRef.current.syncPushToken(t),
    }),
    [],
  );

  // Navega UNA sola vez por respuesta (dedup por identifier): cold start y listener no duplican.
  const handledRef = useRef<Set<string>>(new Set());
  const handleResponse = useCallback((data: unknown, id: string) => {
    if (id) {
      if (handledRef.current.has(id)) return;
      handledRef.current.add(id);
    }
    router.navigate(resolvePushDestination(data) as Href);
    syncRef.current.scheduleNotificationsRefresh();
  }, []);

  // Handler + listeners de recepción/tap; cold start al montar.
  useEffect(() => {
    configureForegroundHandler();
    const received = addReceivedListener(() => syncRef.current.scheduleNotificationsRefresh());
    const response = addResponseListener(handleResponse);
    void getInitialResponse().then((r) => {
      if (r) handleResponse(r.data, r.id);
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, [handleResponse]);

  // Reconciliación en boot (check-only, sin prompt) + rotación del token, cuando hay device.
  useEffect(() => {
    if (!deviceId) return;
    void reconcilePush(bridge);
    const rotation = subscribeTokenRotation(bridge);
    return () => rotation.remove();
  }, [deviceId, bridge]);

  return null;
}
