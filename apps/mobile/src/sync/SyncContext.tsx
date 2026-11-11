/**
 * Motor offline-first del cliente móvil (doc Arquitectura §6.1, §12):
 * la UI lee y escribe SOLO contra el store local (SyncDevice de
 * @cowinance/sync-core). Persistencia incremental vía DeviceStorage
 * (SQLite en nativo, AsyncStorage en web) y sincronización automática:
 * al arrancar, tras cada captura (debounce) y cada 60 s en primer plano.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { SyncDevice, Changeset, PushResult, PullResult, RemoteChangeset } from '@cowinance/sync-core';
import { setFarmTimeZone, getFarmTimeZone } from '../lib/date';
import { createStorage } from './storage';
import type { DeviceStorage, PersistedMeta, AgendaItem } from './storage.types';
import {
  describePending,
  effectiveWithdrawal,
  findAnimalByTag,
  findOpenPregnancy,
  getAnimal,
  listAnimalEvents,
  listAnimals,
  listBulls,
  listCategoriesInUse,
  listLots,
  listProducts,
  listTasks,
  tieneCapacidad,
} from './store-queries';
import {
  stageCalving,
  stageDiagnosis,
  stageHeat,
  stageMortality,
  stageMovement,
  stageNewAnimal,
  stageNote,
  stageService,
  stageTaskCreate,
  stageTaskFields,
  stageTreatment,
  stageVaccination,
  stageWeaning,
  stageWeighing,
} from './capture-actions';
import { decidirCambioDeFinca, decidirIngreso } from './session-rules';
import type { PulledChangesetWire, ServerConflict, SyncCtx } from './sync-types';
import {
  type CachedNotification,
  type NotificationCacheState,
  addReadPending,
  classifyReadPost,
  countUnread,
  hydrateCachedNotifications,
  normalizeReadPending,
  prunePending,
  reconcileView,
  reduceRefresh,
} from './notification-cache';
export type { AgendaItem } from './storage.types';
export type { CachedNotification } from './notification-cache';
// Las pantallas siguen importando los tipos desde acá: el contrato público del módulo no cambia
// porque las definiciones se hayan mudado a `sync-types`.
export type {
  AnimalEventRow,
  AnimalRow,
  LocalPregnancy,
  LotRow,
  PendingItem,
  ServerConflict,
  SyncCtx,
  TaskRow,
  VetProduct,
} from './sync-types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const AUTO_SYNC_INTERVAL_MS = 60_000;
const POST_CAPTURE_DEBOUNCE_MS = 2_500;

const Ctx = createContext<SyncCtx | null>(null);
export const useSync = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSync fuera de SyncProvider');
  return ctx;
};

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const storageRef = useRef<DeviceStorage>(createStorage());
  const deviceRef = useRef<SyncDevice | null>(null);
  const metaRef = useRef<PersistedMeta | null>(null);
  const offlineRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<'boot' | 'login' | 'ready' | 'error'>('boot');
  const [errorMsg, setErrorMsg] = useState<string>();
  const [version, setVersion] = useState(0);
  const [offlineSim, setOfflineSimState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<string>();
  const bump = () => setVersion((v) => v + 1);

  const pushConflictsRef = useRef(0);

  /**
   * Fetch autenticado: Bearer del meta persistido; ante 401 intenta UNA
   * rotación de refresh y reintenta; si sigue 401 → pantalla de login.
   */
  const authFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const doFetch = () =>
      fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
          ...(metaRef.current?.accessToken ? { Authorization: `Bearer ${metaRef.current.accessToken}` } : {}),
        },
      });
    let res = await doFetch();
    if (res.status === 401 && metaRef.current?.refreshToken) {
      const r = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: metaRef.current.refreshToken }),
      });
      if (r.ok) {
        const j = await r.json();
        metaRef.current = { ...metaRef.current, accessToken: j.access_token, refreshToken: j.refresh_token };
        await storageRef.current.saveMeta(metaRef.current);
        res = await doFetch();
      }
    }
    if (res.status === 401) {
      metaRef.current = { ...metaRef.current, accessToken: undefined, refreshToken: undefined };
      await storageRef.current.saveMeta(metaRef.current!);
      setStatus('login');
    }
    return res;
  }, []);

  /**
   * Única función de mutación/persistencia de meta (D8): el mutator parte SIEMPRE del valor
   * más reciente de metaRef, evitando el read-modify-write sobre snapshots obsoletos cuando
   * syncNow, la pantalla y taps rápidos concurren. No hay store nuevo.
   */
  const persistMeta = useCallback(async (mutate: (prev: PersistedMeta) => PersistedMeta) => {
    if (!metaRef.current) return;
    metaRef.current = mutate(metaRef.current);
    await storageRef.current.saveMeta(metaRef.current);
  }, []);

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
  }, [authFetch, persistMeta]);

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
    [authFetch, persistMeta],
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
    [authFetch, persistMeta],
  );

  const transport = useMemo(
    () => ({
      push: async (changesets: Changeset[]): Promise<PushResult> => {
        const res = await authFetch(`/sync/push`, {
          method: 'POST',
          body: JSON.stringify({ device_id: metaRef.current!.serverDeviceId, changesets }),
        });
        if (!res.ok) throw new Error(`push → ${res.status}`);
        const j = await res.json();
        pushConflictsRef.current += (j.conflicts ?? []).length;
        return { accepted: j.accepted, deduped: j.deduped, conflicts: j.conflicts ?? [], serverCursor: j.server_cursor };
      },
      pull: async (after: number): Promise<PullResult> => {
        const res = await authFetch(`/sync/pull?device_id=${metaRef.current!.serverDeviceId}&cursor=${after}`);
        if (!res.ok) throw new Error(`pull → ${res.status}`);
        const j = (await res.json()) as { cursor: number; changesets: PulledChangesetWire[] };
        return {
          cursor: j.cursor,
          changesets: j.changesets.map((c) => {
            // Server-origin (deviceId/seq null) se aplica directo por SyncDevice.sync
            // (ops/hlc/cursor); ya no se rechaza ni se fabrica identidad (ADR-0016).
            const changeset: RemoteChangeset = {
              id: c.id,
              deviceId: c.device_id,
              seq: c.seq,
              hlc: c.hlc,
              schemaVersion: c.schema_version,
              ops: c.ops,
            };
            return { serverSeq: c.server_seq, changeset };
          }),
        };
      },
    }),
    [authFetch],
  );

  const syncNow = useCallback(async (): Promise<{ pushed: number; pulled: number } | { error: string }> => {
    const d = deviceRef.current;
    if (!d || !metaRef.current) return { error: 'sin dispositivo' };
    if (offlineRef.current) {
      const msg = 'Sin señal (simulada) — los registros quedan en cola';
      setLastSyncResult(msg);
      return { error: msg };
    }
    setSyncing(true);
    pushConflictsRef.current = 0;
    try {
      const result = await d.sync(transport);
      // Cache-on-sync de la agenda (P4-2), best-effort: si el fetch falla se conserva el
      // snapshot anterior — el sync (push/pull) ya fue exitoso y la agenda es secundaria.
      let agenda = metaRef.current.agenda;
      let agendaAt = metaRef.current.agendaAt;
      try {
        const r = await authFetch('/agenda');
        if (r.ok) {
          agenda = (await r.json()) as AgendaItem[];
          agendaAt = new Date().toISOString();
        }
      } catch {
        /* red: se mantiene el cache previo */
      }
      await persistMeta((prev) => ({ ...prev, lastSyncAt: new Date().toISOString(), agenda, agendaAt }));
      // Cache-on-sync del feed in_app (P7-4.c), best-effort e independiente: su fallo no
      // afecta el push/pull ya exitoso. refreshNotifications encapsula su propio try/catch.
      await refreshNotifications();
      const conflictNote = pushConflictsRef.current
        ? ` · ${pushConflictsRef.current} conflicto${pushConflictsRef.current === 1 ? '' : 's'} en revisión`
        : '';
      setLastSyncResult(`Sync OK — ${result.pushed} subidos, ${result.pulled} recibidos${conflictNote}`);
      bump();
      return result;
    } catch (e: any) {
      setLastSyncResult(`Error de sync: ${e.message}`);
      return { error: e.message };
    } finally {
      setSyncing(false);
    }
  }, [transport, authFetch, persistMeta, refreshNotifications]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!offlineRef.current) syncNow();
    }, POST_CAPTURE_DEBOUNCE_MS);
  }, [syncNow]);

  /**
   * Refresh del feed in_app con anti-ráfaga (P7 F2.b): coalesce una ráfaga de pushes en un solo
   * refresh (debounce trailing, mismo patrón que scheduleSync), en vez de disparar N refrescos.
   * No fuerza un sync CRDT completo.
   */
  const scheduleNotificationsRefresh = useCallback(() => {
    if (notifRefreshDebounceRef.current) clearTimeout(notifRefreshDebounceRef.current);
    notifRefreshDebounceRef.current = setTimeout(() => {
      if (!offlineRef.current) refreshNotifications();
    }, POST_CAPTURE_DEBOUNCE_MS);
  }, [refreshNotifications]);

  const init = useCallback(async () => {
    try {
      const storage = storageRef.current;
      await storage.init();
      const [meta, saved] = await Promise.all([storage.loadMeta(), storage.loadDevice()]);
      metaRef.current = meta;
      // Arranque en frío, quizá sin señal: la zona de la finca sale de lo persistido, no de la red.
      setFarmTimeZone(meta?.farmTimeZone);

      if (!meta?.accessToken) {
        setStatus('login');
        return;
      }

      if (meta.serverDeviceId && saved) {
        const d = SyncDevice.restore(saved);
        storage.attach(d);
        deviceRef.current = d;
        setStatus('ready');
        bump();
        return;
      }

      // Primer arranque de este usuario: registrar dispositivo + snapshot inicial
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      const reg = await authFetch(`/sync/devices`, {
        method: 'POST',
        body: JSON.stringify({ platform, device_name: `Móvil ${platform}`, app_version: '0.1.0' }),
      });
      if (reg.status === 401) return; // authFetch ya nos mandó a login
      if (!reg.ok) throw new Error(`registro de dispositivo → ${reg.status}`);
      const device = await reg.json();

      const boot = await authFetch(`/sync/bootstrap?device_id=${device.id}`);
      if (!boot.ok) throw new Error(`bootstrap → ${boot.status}`);
      const snapshot = await boot.json();

      const d = new SyncDevice(device.id);
      storage.attach(d); // antes de hidratar: las filas del snapshot se persisten como mutaciones
      d.hydrate(snapshot.rows ?? snapshot.animals, snapshot.cursor);
      deviceRef.current = d;
      metaRef.current = {
        ...metaRef.current,
        serverDeviceId: device.id,
        farmName: snapshot.farm?.name,
        farmId: snapshot.farm?.id,
        farmTimeZone: snapshot.farm?.timezone ?? undefined,
        capabilities: snapshot.capabilities ?? undefined,
        lastSyncAt: new Date().toISOString(),
      };
      // Antes de `setStatus('ready')`: a partir de ahí se puede capturar, y capturar FECHA.
      setFarmTimeZone(metaRef.current.farmTimeZone);
      await storage.saveMeta(metaRef.current);
      setStatus('ready');
      bump();
    } catch (e: any) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }, [authFetch]);

  useEffect(() => {
    init();
  }, [init]);

  /** Operaciones locales sin subir del store actual (dueño previo), sin hidratarlo. */
  const savedPendingCount = useCallback(async (): Promise<number> => {
    if (deviceRef.current) return deviceRef.current.pendingCount;
    const saved = await storageRef.current.loadDevice();
    if (!saved) return 0;
    try {
      return SyncDevice.restore(saved).pendingCount;
    } catch {
      return 0;
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const res = await fetch(`${API_URL}/auth/login`, {
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
          await storageRef.current.reset();
          deviceRef.current = null;
          metaRef.current = null;
        }

        metaRef.current = {
          ...metaRef.current,
          accessToken: j.access_token,
          refreshToken: j.refresh_token,
          userName: j.user?.name,
          userEmail: j.user?.email,
          userId: newUserId,
          tenantId: newTenantId,
          organizations: j.organizations ?? [],
        };
        await storageRef.current.saveMeta(metaRef.current!);
        setStatus('boot');
        await init();
        return null;
      } catch (e: any) {
        return `Sin conexión con la API (${e.message})`;
      }
    },
    [init, savedPendingCount],
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
      await storageRef.current.reset();
      deviceRef.current = null;
      metaRef.current = {
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
      };
      await storageRef.current.saveMeta(metaRef.current!);
      setFarmTimeZone(null);
      setStatus('boot');
      await init();
      return null;
    },
    [authFetch, init, savedPendingCount],
  );

  const logout = useCallback(async () => {
    if (metaRef.current?.refreshToken) {
      fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: metaRef.current.refreshToken }),
      }).catch(() => {});
    }
    metaRef.current = { ...metaRef.current, accessToken: undefined, refreshToken: undefined };
    await storageRef.current.saveMeta(metaRef.current!);
    // La zona es de la finca que se está dejando: si entra otra cuenta, hasta su bootstrap se fecha
    // con la del teléfono y no con la del tenant anterior. Mismo criterio que el resto del cierre.
    setFarmTimeZone(null);
    setStatus('login');
  }, []);

  // Sync automático: al quedar listo y luego cada 60 s
  useEffect(() => {
    if (status !== 'ready') return;
    syncNow();
    const t = setInterval(() => {
      if (!offlineRef.current) syncNow();
    }, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(t);
  }, [status, syncNow]);

  const setOfflineSim = useCallback(
    (v: boolean) => {
      offlineRef.current = v;
      setOfflineSimState(v);
      if (!v) syncNow(); // recuperó señal → drenar la cola de inmediato
    },
    [syncNow],
  );

  const value = useMemo<SyncCtx>(() => {
    const store = () => deviceRef.current?.store;

    /**
     * El ciclo que comparte TODA captura: escribir sobre el dispositivo, cerrar el changeset,
     * avisarle a la UI y programar el envío. Estaba repetido veinte veces, una por captura, y
     * cada repetición era una oportunidad de olvidarse del `commit()` — que es exactamente la
     * forma en que una captura se pierde sin dejar rastro.
     *
     * Sin dispositivo todavía (arranque en frío) devuelve el valor neutro en vez de romper. Si el
     * commit no produjo changeset no hay nada que sincronizar: hoy el único caso es una nota que
     * quedó vacía tras el trim.
     */
    const capturar = <T,>(neutro: T, escribir: (d: SyncDevice) => T): T => {
      const d = deviceRef.current;
      if (!d) return neutro;
      const resultado = escribir(d);
      if (d.commit()) {
        bump();
        scheduleSync();
      }
      return resultado;
    };

    return {
      status,
      errorMsg,
      userName: metaRef.current?.userName,
      userEmail: metaRef.current?.userEmail,
      userId: metaRef.current?.userId,
      authFetch,
      login,
      logout,
      organizations: metaRef.current?.organizations ?? [],
      tenantId: metaRef.current?.tenantId,
      switchOrganization,
      farmName: metaRef.current?.farmName,
      // Del módulo de fecha y no de la meta: lo que importa mostrar es la zona que se está USANDO
      // para fechar, no la que quedó guardada. Si difirieran, el diagnóstico mentiría.
      farmTimeZone: getFarmTimeZone(),
      lastSyncAt: metaRef.current?.lastSyncAt,
      lastSyncResult,
      storageEngine: storageRef.current.engine,
      pendingCount: deviceRef.current?.pendingCount ?? 0,
      offlineSim,
      syncing,
      version,

      animals: (query?: string) => listAnimals(store(), query),
      animal: (id: string) => getAnimal(store(), id),
      findByTag: (tag: string) => findAnimalByTag(store(), tag),
      animalEvents: (id: string) => listAnimalEvents(store(), id),
      products: (type?: 'vaccine' | 'other') => listProducts(store(), type),
      bulls: () => listBulls(store()),
      lots: () => listLots(store()),
      tasks: () => listTasks(store()),

      // Agenda diaria cacheada (P4-2): snapshot del último sync exitoso, usable offline.
      agenda: (): AgendaItem[] => metaRef.current?.agenda ?? [],
      agendaAt: metaRef.current?.agendaAt,

      // Feed in_app cacheado (P7-4.c): vista reconciliada (snapshot + read-set), fuente única
      // para pantalla y badge; usable offline.
      notifications: (): CachedNotification[] => reconcileView(metaRef.current?.notifications, metaRef.current?.notificationReadPending),
      unreadNotifications: (): number => countUnread(reconcileView(metaRef.current?.notifications, metaRef.current?.notificationReadPending)),
      notificationsAt: metaRef.current?.notificationsAt,
      markNotificationRead,
      refreshNotifications,

      // Registro de push (P7 F2.a): identidad del device + último token confirmado (para el puente
      // nativo) y sincronización del token Expo. La obtención del token y los permisos son nativos.
      serverDeviceId: metaRef.current?.serverDeviceId,
      pushLastToken: metaRef.current?.lastPushToken,
      syncPushToken,
      scheduleNotificationsRefresh,

      withdrawalOf: (animalId: string) => effectiveWithdrawal(store(), animalId),

      puede: (cap: string, access: 'read' | 'write' = 'write') =>
        tieneCapacidad(metaRef.current?.capabilities, cap, access),

      openPregnancy: (animalId: string) => findOpenPregnancy(store(), animalId),

      captureVaccination: (animalId, productId, dose, batch) =>
        capturar(undefined, (d) => stageVaccination(d, animalId, productId, dose, batch, new Date(), Crypto.randomUUID)),

      // La zona del DISPOSITIVO y no la de la finca: el teléfono está físicamente ahí, y el
      // retiro de carne se cuenta en días de calendario. Ver `stageTreatment`.
      captureTreatment: (animalId, productId, dose, route) =>
        capturar({ meatUntil: null }, (d) =>
          stageTreatment(d, animalId, productId, dose, route, new Date(), Crypto.randomUUID, Intl.DateTimeFormat().resolvedOptions().timeZone),
        ),

      captureHeat: (animalId) => capturar(undefined, (d) => stageHeat(d, animalId, new Date(), Crypto.randomUUID)),
      captureService: (animalId, method, sireId) =>
        capturar(undefined, (d) => stageService(d, animalId, method, sireId, new Date(), Crypto.randomUUID)),
      captureDiagnosis: (animalId, result) =>
        capturar({}, (d) => stageDiagnosis(d, animalId, result, new Date(), Crypto.randomUUID)),
      captureCalving: (damId, calf) =>
        capturar({ calfId: '' }, (d) => stageCalving(d, damId, calf, new Date(), Crypto.randomUUID)),
      captureNewAnimal: (a) => capturar({ animalId: '' }, (d) => stageNewAnimal(d, a, new Date(), Crypto.randomUUID)),

      categoriesInUse: () => listCategoriesInUse(store()),

      captureMovement: (animalId, toLotId, reason) =>
        capturar(undefined, (d) => stageMovement(d, animalId, toLotId, reason, new Date(), Crypto.randomUUID)),
      captureMortality: (animalId, notes) =>
        capturar(undefined, (d) => stageMortality(d, animalId, notes, new Date(), Crypto.randomUUID)),
      captureWeaning: (animalId, weightKg) =>
        capturar(undefined, (d) => stageWeaning(d, animalId, weightKg, new Date(), Crypto.randomUUID)),
      // Una nota vacía no emite nada; `capturar` tampoco sincroniza porque el commit no produce
      // changeset. Es el único caso en que una captura puede no dejar rastro, y es intencional.
      captureNote: (animalId, text) => {
        capturar(false, (d) => stageNote(d, animalId, text, new Date(), Crypto.randomUUID));
      },

      captureTaskCreate: (title, opts) => {
        capturar(false, (d) => stageTaskCreate(d, title, opts, Crypto.randomUUID));
      },
      captureTaskComplete: (taskId) =>
        capturar(undefined, (d) => stageTaskFields(d, taskId, { status: 'done', completed_at: new Date().toISOString() })),
      captureTaskStart: (taskId) => capturar(undefined, (d) => stageTaskFields(d, taskId, { status: 'in_progress' })),
      captureTaskCancel: (taskId) => capturar(undefined, (d) => stageTaskFields(d, taskId, { status: 'canceled' })),
      // Sin `status` → el handler lo lee como reprogramar; sin `status` ni `due_date` → asignar.
      captureTaskReschedule: (taskId, dueDate) => capturar(undefined, (d) => stageTaskFields(d, taskId, { due_date: dueDate })),
      captureTaskAssign: (taskId, assignedTo) => capturar(undefined, (d) => stageTaskFields(d, taskId, { assigned_to: assignedTo })),

      captureWeighing: (animalId, kg, cc) =>
        capturar(undefined, (d) => stageWeighing(d, animalId, kg, cc, new Date(), Crypto.randomUUID)),

      pendingDetail: () => describePending(deviceRef.current?.pendingChangesets ?? [], store()),

      fetchConflicts: async () => {
        if (offlineRef.current) return { error: 'Sin señal — los conflictos se revisan con conexión' };
        try {
          const res = await authFetch(`/sync/conflicts`);
          if (!res.ok) throw new Error(`conflicts → ${res.status}`);
          return (await res.json()) as ServerConflict[];
        } catch (e: any) {
          return { error: e.message };
        }
      },

      resolveConflict: async (conflictId: string) => {
        try {
          const res = await authFetch(`/sync/resolve`, {
            method: 'POST',
            body: JSON.stringify({ conflict_id: conflictId, resolution: 'manual' }),
          });
          return res.ok;
        } catch {
          return false;
        }
      },

      syncNow,
      setOfflineSim,
      resetLocal: async () => {
        await storageRef.current.reset();
        deviceRef.current = null;
        metaRef.current = null;
        setStatus('boot');
        init();
      },
    };
  }, [status, errorMsg, version, offlineSim, syncing, lastSyncResult, syncNow, setOfflineSim, scheduleSync, init, login, logout, switchOrganization, authFetch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
