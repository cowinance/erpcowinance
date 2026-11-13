/**
 * Las acciones de SESIÓN del móvil: entrar, cambiar de finca y salir.
 *
 * Viven acá y no en `SyncContext` porque son un concepto propio —quién es el dueño de los datos de
 * este teléfono— y porque las tres comparten una regla que no es obvia: **el store local es
 * propiedad de `(userId, tenantId)`**. El backend rechaza con 404 un `device_id` de otro tenant, así
 * que una base ajena no solo sería inútil: expondría datos de otra cuenta. De ahí que entrar con
 * otra identidad o cambiar de finca signifique descartar la base y bootstrapear de nuevo, y que las
 * dos operaciones se bloqueen cuando hay capturas sin subir.
 *
 * El contrato con el provider es por parámetros, igual que `use-notificaciones`: este módulo no
 * conoce React Context ni el ciclo de vida del dispositivo, solo recibe lo que necesita tocar.
 */
import { useCallback } from 'react';
import { SyncDevice } from '@cowinance/sync-core';
import { setFarmTimeZone } from '../lib/date';
import { decidirCambioDeFinca, decidirIngreso } from './session-rules';
import type { DeviceStorage, PersistedMeta } from './storage.types';

export interface OpcionesDeSesion {
  apiUrl: string;
  almacen: DeviceStorage;
  metaRef: React.RefObject<PersistedMeta | null>;
  deviceRef: React.RefObject<SyncDevice | null>;
  aplicarMeta: (next: PersistedMeta | null) => void;
  setStatus: (s: 'boot' | 'login' | 'ready' | 'error') => void;
  /** Rehidrata el dispositivo tras un cambio de identidad. Lo aporta el provider. */
  init: () => Promise<void>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export function useSesion({ apiUrl, almacen, metaRef, deviceRef, aplicarMeta, setStatus, init, authFetch }: OpcionesDeSesion) {
  /** Operaciones locales sin subir del store actual (dueño previo), sin hidratarlo. */
  const savedPendingCount = useCallback(async (): Promise<number> => {
    if (deviceRef.current) return deviceRef.current.pendingCount;
    const saved = await almacen.loadDevice();
    if (!saved) return 0;
    try {
      return SyncDevice.restore(saved).pendingCount;
    } catch {
      return 0;
    }
  }, [almacen, deviceRef]);

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const res = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) return j?.message?.title ?? 'Credenciales inválidas';

        // Aislamiento local por usuario/tenant (P1.3.6a). El store operativo es
        // propiedad de (userId, tenantId); el backend además rechaza un device_id
        // de otro tenant (404), así que un store ajeno sería inservible y expondría
        // datos de otra cuenta. Si la identidad autenticada no coincide con la dueña
        // del store, se descarta ANTES de hidratar/renderizar y se arranca limpio.
        const newUserId: string | undefined = j.user?.id;
        const newTenantId: string | undefined = j.user?.tenant_id;
        const prev = metaRef.current;
        const decision = await decidirIngreso({
          storeExistente: !!prev?.serverDeviceId,
          mismoDueno: !!newUserId && prev?.userId === newUserId && prev?.tenantId === newTenantId,
          contarPendientes: savedPendingCount,
        });
        // No perder cambios locales sin subir del dueño anterior: no se pueden enviar bajo la
        // cuenta nueva (device de otro tenant → 404) ni descartar en silencio.
        if (decision.accion === 'bloquear') return decision.mensaje;
        if (decision.accion === 'descartar') {
          await almacen.reset();
          deviceRef.current = null;
          aplicarMeta(null);
        }

        aplicarMeta({
          ...metaRef.current,
          accessToken: j.access_token,
          refreshToken: j.refresh_token,
          userName: j.user?.name,
          userEmail: j.user?.email,
          userId: newUserId,
          tenantId: newTenantId,
          organizations: j.organizations ?? [],
        });
        await almacen.saveMeta(metaRef.current!);
        setStatus('boot');
        await init();
        return null;
      } catch (e: any) {
        return `Sin conexión con la API (${e.message})`;
      }
    },
    [apiUrl, init, savedPendingCount, almacen, aplicarMeta, metaRef, deviceRef, setStatus],
  );

  /**
   * Cambia de organización sin volver a pedir la contraseña.
   *
   * **En el móvil esto NO es cambiar un token, como en la web: es cambiar el dataset entero.** El
   * store local es propiedad de `(userId, tenantId)` —el backend rechaza con 404 un `device_id` de
   * otro tenant— así que la finca nueva arranca con una base vacía y un bootstrap completo. En un
   * teléfono en el campo eso puede ser varios minutos y muchos megas.
   *
   * De ahí las dos decisiones que siguen:
   *
   *  · **Con cambios sin sincronizar NO se cambia.** No se pueden subir bajo la otra finca ni
   *    descartar en silencio: es el trabajo del día. Se bloquea y se dice cuántos son, con el
   *    mismo texto que ya usa el login cuando entra otra cuenta en un dispositivo con pendientes.
   *  · **Se emite el par de tokens ANTES de tocar el store.** Si `/auth/switch` falla —sin señal,
   *    acceso revocado— la persona se queda donde estaba, con sus datos intactos. Al revés
   *    quedaría con la base borrada y sin sesión en ningún lado.
   */
  const switchOrganization = useCallback(
    async (tenantId: string): Promise<string | null> => {
      const decision = await decidirCambioDeFinca({
        organizaciones: metaRef.current?.organizations ?? [],
        fincaActual: metaRef.current?.tenantId,
        destino: tenantId,
        contarPendientes: savedPendingCount,
      });
      if (decision.accion === 'bloquear') return decision.mensaje;
      if (decision.accion === 'seguir') return null; // ya estás ahí

      let j: any;
      try {
        const res = await authFetch('/auth/switch', { method: 'POST', body: JSON.stringify({ organization_id: tenantId }) });
        j = await res.json().catch(() => null);
        if (!res.ok) return j?.message?.title ?? j?.title ?? 'No se pudo cambiar de finca.';
      } catch (e: any) {
        return `Sin conexión con la API (${e.message})`;
      }

      // Recién ahora se descarta lo local: el token nuevo ya está en la mano.
      await almacen.reset();
      deviceRef.current = null;
      aplicarMeta({
        ...metaRef.current,
        accessToken: j.access_token,
        refreshToken: j.refresh_token,
        userId: j.user?.id,
        tenantId: j.user?.tenant_id,
        // Se conserva la lista: es de la PERSONA, no de la finca, y sin ella el selector
        // desaparecería justo después de usarlo.
        organizations: metaRef.current?.organizations ?? [],
        // Lo que sí es de la finca que se deja: nombre, zona, agenda y notificaciones. Arrastrarlos
        // haría que el menú informe la finca anterior hasta el primer sync.
        farmName: undefined,
        agenda: undefined,
        notifications: undefined,
        lastSyncAt: undefined,
        serverDeviceId: undefined,
      });
      await almacen.saveMeta(metaRef.current!);
      setFarmTimeZone(null);
      setStatus('boot');
      await init();
      return null;
    },
    [authFetch, init, savedPendingCount, almacen, aplicarMeta, metaRef, deviceRef, setStatus],
  );

  const logout = useCallback(async () => {
    if (metaRef.current?.refreshToken) {
      fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: metaRef.current.refreshToken }),
      }).catch(() => {});
    }
    aplicarMeta({ ...metaRef.current, accessToken: undefined, refreshToken: undefined });
    await almacen.saveMeta(metaRef.current!);
    // La zona es de la finca que se está dejando: si entra otra cuenta, hasta su bootstrap se fecha
    // con la del teléfono y no con la del tenant anterior. Mismo criterio que el resto del cierre.
    setFarmTimeZone(null);
    setStatus('login');
  }, [apiUrl, almacen, aplicarMeta, metaRef, setStatus]);

  return { savedPendingCount, login, switchOrganization, logout };
}
