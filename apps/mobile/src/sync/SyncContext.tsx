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
import { SyncDevice, Changeset, Op, PushResult, PullResult, RemoteChangeset } from '@cowinance/sync-core';
import {
  computeWithdrawal,
  computeExpectedDueDateFromService,
  computeExpectedDueDateFromDiagnosis,
  newbornCategoryCode,
} from '@cowinance/domain';
import { createStorage } from './storage';
import type { DeviceStorage, PersistedMeta, AgendaItem } from './storage.types';
import { buildMortalityEmit, buildWeaningEmit, buildNoteEmit } from './capture-builders';
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

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const AUTO_SYNC_INTERVAL_MS = 60_000;
const POST_CAPTURE_DEBOUNCE_MS = 2_500;

/** Forma cruda de un changeset en la respuesta de pull (wire, snake_case). */
interface PulledChangesetWire {
  server_seq: number;
  device_id: string | null;
  seq: number | null;
  hlc: string;
  id: string;
  schema_version: number;
  ops: Op[];
}

// `RemoteChangeset` (changeset recibido por pull, con deviceId/seq nullable) vive
// ahora en sync-core (ADR-0016, P-a). El apply de un server-origin lo hace
// SyncDevice.sync por ops/hlc/cursor; ya no hace falta puente ni throw en el móvil.

export interface AnimalRow {
  id: string;
  tag?: string;
  name?: string;
  status?: string;
  sex?: string;
  category?: string;
  /** Lote actual (sincronizable). El nombre se resuelve del catálogo por este id. */
  current_lot_id?: string | null;
  lot_name?: string;
  last_weight_kg?: number;
  last_weighed_at?: string;
}

export interface VetProduct {
  id: string;
  name: string;
  type: string;
  withdrawal_meat_days?: number;
  withdrawal_milk_hours?: number;
  default_dose?: string;
}

/** Lote del catálogo local (P3 M-3.1): destino de movimientos, usable 100% offline. */
export interface LotRow {
  id: string;
  name: string;
  current_paddock_id: string | null;
  paddock_name: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  due_date: string | null;
  priority: string;
  related_type: string | null;
  related_id: string | null;
}

export interface LocalPregnancy {
  id: string;
  animal_id: string;
  status: string;
  diagnosis_date?: string;
  expected_due_date?: string;
}

export interface PendingItem {
  seq: number;
  summary: string;
  tag?: string;
}

export interface ServerConflict {
  id: string;
  conflict_type: string;
  entity_type: string;
  detail: string;
  tag?: string;
  created_at: string;
  resolution?: string;
  resolved_at?: string;
}

interface SyncCtx {
  status: 'boot' | 'login' | 'ready' | 'error';
  errorMsg?: string;
  userName?: string;
  userEmail?: string;
  /**
   * Fetch autenticado (Bearer + rotación de refresh + 401→login). Expuesto para
   * que la capa de cuenta (AccountContext) reutilice el MISMO mecanismo de auth
   * al leer /auth/me — sin un segundo flujo de refresh ni tocar el store de sync.
   */
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  farmName?: string;
  lastSyncAt?: string;
  lastSyncResult?: string;
  storageEngine: string;
  pendingCount: number;
  offlineSim: boolean;
  syncing: boolean;
  version: number;
  animals: (query?: string) => AnimalRow[];
  animal: (id: string) => AnimalRow | null;
  animalEvents: (id: string) => { id: string; type: string; at: string; data: Record<string, unknown> }[];
  findByTag: (tag: string) => AnimalRow | null;
  products: (type?: 'vaccine' | 'other') => VetProduct[];
  bulls: () => AnimalRow[];
  lots: () => LotRow[];
  /** Tareas locales (bootstrap pendientes + completadas en sesión), 100% offline (P6-3). */
  tasks: () => TaskRow[];
  /** Crea una tarea offline (put sobre tasks; el servidor sanea a general/pending). */
  captureTaskCreate: (title: string, opts?: { dueDate?: string | null; priority?: string }) => void;
  /** Completa una tarea offline (put status='done' + completed_at del device). */
  captureTaskComplete: (taskId: string) => void;
  /** Agenda diaria cacheada (P4-2), usable offline; `agendaAt` = cuándo se refrescó. */
  agenda: () => AgendaItem[];
  agendaAt?: string;
  /** Feed in_app cacheado (P7-4.c), vista reconciliada (snapshot + read-set), usable offline. */
  notifications: () => CachedNotification[];
  /** Conteo de no leídas sobre la vista reconciliada (misma fuente que `notifications()`). */
  unreadNotifications: () => number;
  /** Cuándo se refrescó el snapshot del feed in_app. */
  notificationsAt?: string;
  /** Marca leída (optimista + persistente) y hace POST /read best-effort; no navega. */
  markNotificationRead: (id: string) => Promise<void>;
  /** Refresca el feed in_app (flush de reads pendientes + GET), reutilizable al enfocar la pantalla. */
  refreshNotifications: () => Promise<void>;
  /** Id del device registrado en el servidor (para asociar el token de push). */
  serverDeviceId?: string;
  /** Último token Expo confirmado con el servidor (optimización local de idempotencia). */
  pushLastToken?: string;
  /** Sincroniza el token Expo con el servidor (POST push-token + persiste lastPushToken). */
  syncPushToken: (token: string) => Promise<void>;
  openPregnancy: (animalId: string) => LocalPregnancy | null;
  captureWeighing: (animalId: string, kg: number, cc?: number) => void;
  captureVaccination: (animalId: string, productId: string, dose?: number, batch?: string) => void;
  captureTreatment: (animalId: string, productId: string, dose?: number, route?: string) => { meatUntil: string | null };
  captureHeat: (animalId: string) => void;
  captureService: (animalId: string, method: 'ai' | 'natural', sireId?: string) => void;
  captureDiagnosis: (animalId: string, result: 'pregnant' | 'empty') => { expectedDue?: string };
  captureCalving: (damId: string, calf: { sex: 'F' | 'M'; tag?: string }) => { calfId: string };
  /** Mueve un animal a un lote (o lo saca: toLotId=null). Emite SOLO el event op de
   *  animal_movements (event-only, M-3.2.a); el servidor deriva el potrero y converge. */
  captureMovement: (animalId: string, toLotId: string | null, reason?: string) => void;
  /** Baja por muerte (P5-2): emite SOLO el event op de mortalities (event-only, Patrón B);
   *  el servidor autora hecho + status='dead' + timeline y converge por server-origin. */
  captureMortality: (animalId: string, notes?: string) => void;
  /** Destete (P5-2): emite SOLO el event op de weanings; el servidor materializa
   *  atómicamente el hecho, el pesaje determinista (si hay peso) y el timeline. */
  captureWeaning: (animalId: string, weightKg?: number) => void;
  /** Nota libre (P5-2): un event op sobre animal_events (event_type='note'); no emite vacías. */
  captureNote: (animalId: string, text: string) => void;
  pendingDetail: () => PendingItem[];
  fetchConflicts: () => Promise<ServerConflict[] | { error: string }>;
  resolveConflict: (conflictId: string) => Promise<boolean>;
  syncNow: () => Promise<{ pushed: number; pulled: number } | { error: string }>;
  setOfflineSim: (v: boolean) => void;
  resetLocal: () => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);
export const useSync = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSync fuera de SyncProvider');
  return ctx;
};

function rowToAnimal(id: string, fields: Record<string, unknown>, lotName?: (lotId: string) => string | undefined): AnimalRow {
  const currentLotId = (fields.current_lot_id as string) ?? null;
  return {
    id,
    tag: fields.visual_tag as string,
    name: (fields.name as string) ?? undefined,
    status: fields.status as string,
    sex: fields.sex as string,
    category: fields.category as string,
    current_lot_id: currentLotId,
    // El nombre del lote SIEMPRE se resuelve del catálogo (sync.lots()) por
    // current_lot_id: el put de un movimiento actualiza current_lot_id pero NO el
    // lot_name denormalizado, que quedaría obsoleto.
    lot_name: currentLotId ? lotName?.(currentLotId) : undefined,
    last_weight_kg: fields.last_weight_kg as number,
    last_weighed_at: fields.last_weighed_at as string,
  };
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const storageRef = useRef<DeviceStorage>(createStorage());
  const deviceRef = useRef<SyncDevice | null>(null);
  const metaRef = useRef<PersistedMeta | null>(null);
  const offlineRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const init = useCallback(async () => {
    try {
      const storage = storageRef.current;
      await storage.init();
      const [meta, saved] = await Promise.all([storage.loadMeta(), storage.loadDevice()]);
      metaRef.current = meta;

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
        lastSyncAt: new Date().toISOString(),
      };
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
        const storeExists = !!prev?.serverDeviceId;
        const sameOwner = !!newUserId && prev?.userId === newUserId && prev?.tenantId === newTenantId;

        if (storeExists && !sameOwner) {
          // No perder cambios locales sin subir del dueño anterior: no se pueden
          // enviar bajo la cuenta nueva (device de otro tenant → 404) ni descartar
          // en silencio. Se bloquea el cambio hasta sincronizarlos con su cuenta.
          const pending = await savedPendingCount();
          if (pending > 0) {
            return `Este dispositivo tiene ${pending} ${pending === 1 ? 'cambio' : 'cambios'} sin sincronizar de otra cuenta. Ingresá con esa cuenta y sincronizá (o reiniciá la base local desde el Menú) antes de cambiar de usuario.`;
          }
          // Sin pendientes: descartar el store del dueño previo y re-namespace limpio.
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
    // Resolución del nombre de lote desde el catálogo local (M-3.2.b), por current_lot_id.
    const lotNameOf = (lotId: string): string | undefined => store()?.rows.get('lots')?.get(lotId)?.fields.name as string | undefined;

    return {
      status,
      errorMsg,
      userName: metaRef.current?.userName,
      userEmail: metaRef.current?.userEmail,
      authFetch,
      login,
      logout,
      farmName: metaRef.current?.farmName,
      lastSyncAt: metaRef.current?.lastSyncAt,
      lastSyncResult,
      storageEngine: storageRef.current.engine,
      pendingCount: deviceRef.current?.pendingCount ?? 0,
      offlineSim,
      syncing,
      version,

      animals: (query?: string) => {
        const m = store()?.rows.get('animals');
        if (!m) return [];
        const list: AnimalRow[] = [];
        for (const [id, st] of m) {
          if (st.fields.status !== 'active') continue;
          const a = rowToAnimal(id, st.fields, lotNameOf);
          if (query) {
            const q = query.toLowerCase();
            if (!a.tag?.toLowerCase().includes(q) && !a.name?.toLowerCase().includes(q)) continue;
          }
          list.push(a);
        }
        return list.sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? '', undefined, { numeric: true }));
      },

      animal: (id: string) => {
        const st = store()?.getRow('animals', id);
        return st ? rowToAnimal(id, st.fields, lotNameOf) : null;
      },

      findByTag: (tag: string) => {
        const m = store()?.rows.get('animals');
        if (!m) return null;
        for (const [id, st] of m) {
          if (st.fields.status === 'active' && String(st.fields.visual_tag ?? '') === tag.trim()) return rowToAnimal(id, st.fields, lotNameOf);
        }
        return null;
      },

      animalEvents: (id: string) => {
        const m = store()?.events.get('animal_events');
        if (!m) return [];
        const list: { id: string; type: string; at: string; data: Record<string, unknown> }[] = [];
        for (const [eid, row] of m) {
          if (row.animal_id !== id) continue;
          list.push({ id: eid, type: String(row.event_type), at: String(row.occurred_at), data: (row.payload as any) ?? {} });
        }
        return list.sort((a, b) => (a.at < b.at ? 1 : -1));
      },

      products: (type?: 'vaccine' | 'other') => {
        const m = store()?.rows.get('products_veterinary');
        if (!m) return [];
        const list: VetProduct[] = [];
        for (const [id, st] of m) {
          const p = { id, ...(st.fields as any) } as VetProduct;
          if (type === 'vaccine' && p.type !== 'vaccine') continue;
          if (type === 'other' && p.type === 'vaccine') continue;
          list.push(p);
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
      },

      bulls: () => {
        const m = store()?.rows.get('animals');
        if (!m) return [];
        const list: AnimalRow[] = [];
        for (const [id, st] of m) {
          if (st.fields.status === 'active' && st.fields.category_code === 'toro') list.push(rowToAnimal(id, st.fields, lotNameOf));
        }
        return list;
      },

      // Catálogo de lotes hidratado en el bootstrap (P3 M-3.1). Colección estable
      // (orden por nombre) y 100% offline: lee del store local, sin red.
      lots: (): LotRow[] => {
        const m = store()?.rows.get('lots');
        if (!m) return [];
        const list: LotRow[] = [];
        for (const [id, st] of m) {
          const f = st.fields as any;
          list.push({ id, name: String(f.name ?? ''), current_paddock_id: (f.current_paddock_id as string) ?? null, paddock_name: (f.paddock_name as string) ?? null });
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
      },

      // Tareas hidratadas por el bootstrap (P6-1.b.2) + las completadas en la sesión (put
      // local). Colección estable, 100% offline: lee del store local (patrón lots()).
      tasks: (): TaskRow[] => {
        const m = store()?.rows.get('tasks');
        if (!m) return [];
        const list: TaskRow[] = [];
        for (const [id, st] of m) {
          const f = st.fields as any;
          list.push({
            id,
            title: String(f.title ?? ''),
            description: (f.description as string) ?? null,
            type: String(f.type ?? 'general'),
            status: String(f.status ?? 'pending'),
            due_date: (f.due_date as string) ?? null,
            priority: String(f.priority ?? 'normal'),
            related_type: (f.related_type as string) ?? null,
            related_id: (f.related_id as string) ?? null,
          });
        }
        return list;
      },

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

      openPregnancy: (animalId: string) => {
        const m = store()?.rows.get('pregnancies');
        if (!m) return null;
        for (const [id, st] of m) {
          if (st.fields.animal_id === animalId && st.fields.status === 'open')
            return { id, ...(st.fields as any) } as LocalPregnancy;
        }
        return null;
      },

      captureVaccination: (animalId: string, productId: string, dose?: number, batch?: string) => {
        const d = deviceRef.current;
        if (!d) return;
        const now = new Date().toISOString();
        const product = store()?.getRow('products_veterinary', productId)?.fields as any;
        d.addEvent('vaccinations', Crypto.randomUUID(), {
          animal_id: animalId,
          product_id: productId,
          applied_at: now,
          dose: dose ?? null,
          dose_unit: dose ? 'ml' : null,
          batch_number: batch ?? null,
        });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: animalId,
          event_type: 'vaccination',
          payload: { product: product?.name ?? null, dose: dose ?? null },
          occurred_at: now,
        });
        d.commit();
        bump();
        scheduleSync();
      },

      captureTreatment: (animalId: string, productId: string, dose?: number, route?: string) => {
        const d = deviceRef.current;
        if (!d) return { meatUntil: null };
        const now = new Date();
        const product = store()?.getRow('products_veterinary', productId)?.fields as any;
        // Cálculo LOCAL de retiros (el operario necesita saberlo en el campo, sin señal)
        const { meatWithdrawalUntil: meatUntil, milkWithdrawalUntil: milkUntil } = computeWithdrawal(
          now,
          product?.withdrawal_meat_days ?? null,
          product?.withdrawal_milk_hours ?? null,
        );
        d.addEvent('treatments', Crypto.randomUUID(), {
          animal_id: animalId,
          product_id: productId,
          applied_at: now.toISOString(),
          dose: dose ?? null,
          dose_unit: dose ? 'ml' : null,
          route: route ?? null,
          meat_withdrawal_until: meatUntil,
          milk_withdrawal_until: milkUntil,
        });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: animalId,
          event_type: 'treatment',
          payload: { product: product?.name ?? null, withdrawal_meat_until: meatUntil },
          occurred_at: now.toISOString(),
        });
        d.commit();
        bump();
        scheduleSync();
        return { meatUntil };
      },

      captureHeat: (animalId: string) => {
        const d = deviceRef.current;
        if (!d) return;
        const now = new Date().toISOString();
        d.addEvent('breeding_events', Crypto.randomUUID(), { animal_id: animalId, type: 'heat', occurred_at: now });
        d.addEvent('animal_events', Crypto.randomUUID(), { animal_id: animalId, event_type: 'heat', payload: {}, occurred_at: now });
        d.commit();
        bump();
        scheduleSync();
      },

      captureService: (animalId: string, method: 'ai' | 'natural', sireId?: string) => {
        const d = deviceRef.current;
        if (!d) return;
        const now = new Date().toISOString();
        d.addEvent('breeding_events', Crypto.randomUUID(), {
          animal_id: animalId,
          type: method === 'ai' ? 'service_ai' : 'service_natural',
          occurred_at: now,
          sire_id: sireId ?? null,
        });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: animalId,
          event_type: 'service',
          payload: { method },
          occurred_at: now,
        });
        d.commit();
        bump();
        scheduleSync();
      },

      captureDiagnosis: (animalId: string, result: 'pregnant' | 'empty') => {
        const d = deviceRef.current;
        if (!d) return {};
        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        // Preñez abierta local (si existe)
        let openId: string | null = null;
        const pm = store()?.rows.get('pregnancies');
        if (pm) for (const [id, st] of pm) if (st.fields.animal_id === animalId && st.fields.status === 'open') openId = id;

        if (result === 'pregnant') {
          // Fecha probable: último servicio local + gestación; si no hay, estimación conservadora
          let serviceAt: Date | null = null;
          const be = store()?.events.get('breeding_events');
          if (be)
            for (const [, row] of be) {
              if (row.animal_id === animalId && String(row.type).startsWith('service')) {
                const at = new Date(String(row.occurred_at));
                if (!serviceAt || at > serviceAt) serviceAt = at;
              }
            }
          const expectedDue = serviceAt
            ? computeExpectedDueDateFromService(serviceAt)
            : computeExpectedDueDateFromDiagnosis(now);
          d.setFields('pregnancies', Crypto.randomUUID(), {
            animal_id: animalId,
            status: 'open',
            diagnosis_date: today,
            method: 'ultrasound',
            expected_due_date: expectedDue,
          });
          d.addEvent('animal_events', Crypto.randomUUID(), {
            animal_id: animalId,
            event_type: 'pregnancy_diagnosed',
            payload: { method: 'ultrasound', expected_due_date: expectedDue },
            occurred_at: now.toISOString(),
          });
          d.commit();
          bump();
          scheduleSync();
          return { expectedDue };
        }

        if (openId) d.setFields('pregnancies', openId, { status: 'lost', closed_at: today });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: animalId,
          event_type: 'pregnancy_negative',
          payload: { previous_lost: !!openId },
          occurred_at: now.toISOString(),
        });
        d.commit();
        bump();
        scheduleSync();
        return {};
      },

      captureCalving: (damId: string, calf: { sex: 'F' | 'M'; tag?: string }) => {
        const d = deviceRef.current;
        if (!d) return { calfId: '' };
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const dam = store()?.getRow('animals', damId)?.fields as any;

        let pregnancyId: string | null = null;
        const pm = store()?.rows.get('pregnancies');
        if (pm) for (const [id, st] of pm) if (st.fields.animal_id === damId && st.fields.status === 'open') pregnancyId = id;

        const calfId = Crypto.randomUUID();
        const categoryCode = newbornCategoryCode(calf.sex);
        d.setFields('animals', calfId, {
          visual_tag: calf.tag ?? null,
          name: null,
          status: 'active',
          sex: calf.sex,
          birth_date: today,
          category: categoryCode === 'ternero' ? 'Ternero' : 'Ternera',
          category_code: categoryCode,
          dam_id: damId,
          current_lot_id: dam?.current_lot_id ?? null, // hereda el lote de la madre (el nombre se resuelve del catálogo)
          last_weight_kg: null,
          last_weighed_at: null,
        });
        if (pregnancyId) d.setFields('pregnancies', pregnancyId, { status: 'calved', closed_at: today });

        const calvingId = Crypto.randomUUID();
        d.addEvent('calvings', calvingId, {
          dam_id: damId,
          pregnancy_id: pregnancyId,
          calving_date: today,
          offspring_count: 1,
        });
        d.addEvent('calving_offspring', Crypto.randomUUID(), { calving_id: calvingId, animal_id: calfId, vitality: 'live' });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: damId,
          event_type: 'calving',
          payload: { offspring: 1, calf_tag: calf.tag ?? null },
          occurred_at: now.toISOString(),
        });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: calfId,
          event_type: 'birth',
          payload: { dam_tag: dam?.visual_tag ?? null },
          occurred_at: now.toISOString(),
        });
        d.commit();
        bump();
        scheduleSync();
        return { calfId };
      },

      // Movimiento offline (P3 M-3.3.a): emite SOLO el event op de intención. El
      // servidor (MovementSyncHandler → recordMovement) deriva el potrero del lote,
      // escribe hecho+timeline y emite el server-origin put que converge el campo en
      // todos los devices. `toLotId=null` ⇒ sacar del lote. Sin put compañero
      // (atomicidad de M-3.2.a): el lote local converge al sincronizar (accept-lag).
      captureMovement: (animalId: string, toLotId: string | null, reason?: string) => {
        const d = deviceRef.current;
        if (!d) return;
        d.addEvent('animal_movements', Crypto.randomUUID(), {
          animal_id: animalId,
          to_lot_id: toLotId,
          reason: reason ?? 'movimiento',
          moved_at: new Date().toISOString(),
        });
        d.commit();
        bump();
        scheduleSync();
      },

      // Baja por muerte offline (P5-2, Patrón B): emite SOLO el event op de mortalities.
      // El servidor (MortalitySyncHandler → recordMortality) escribe hecho + status='dead'
      // + timeline y emite el server-origin put que converge el estado en todos los devices
      // (incl. el emisor, por pull). Sin put de status ni animal_events compañero: la
      // atomicidad de P5-1 exige que el estado y su hecho viajen juntos (accept-lag).
      captureMortality: (animalId: string, notes?: string) => {
        const d = deviceRef.current;
        if (!d) return;
        const op = buildMortalityEmit(animalId, notes, new Date(), Crypto.randomUUID);
        d.addEvent(op.table, op.rowId, op.row);
        d.commit();
        bump();
        scheduleSync();
      },

      // Destete offline (P5-2, Patrón B): emite SOLO el event op de weanings. El servidor
      // (WeaningSyncHandler → recordWeaning) materializa atómicamente el hecho, el pesaje
      // asociado (si hay peso, con identidad determinista) y el timeline. Fact-only: sin
      // server-origin (no toca campo autoritativo). Sin animal_events ni pesaje compañero.
      captureWeaning: (animalId: string, weightKg?: number) => {
        const d = deviceRef.current;
        if (!d) return;
        const op = buildWeaningEmit(animalId, weightKg, new Date(), Crypto.randomUUID);
        d.addEvent(op.table, op.rowId, op.row);
        d.commit();
        bump();
        scheduleSync();
      },

      // Nota libre offline (P5-2): un único event op sobre animal_events (event_type='note'),
      // cubierto por el AnimalEventSyncHandler existente. La nota aparece de inmediato en el
      // timeline local. No se emiten notas vacías (trim en el builder).
      captureNote: (animalId: string, text: string) => {
        const d = deviceRef.current;
        if (!d) return;
        const op = buildNoteEmit(animalId, text, new Date(), Crypto.randomUUID);
        if (!op) return; // nota vacía tras trim → no se emite
        d.addEvent(op.table, op.rowId, op.row);
        d.commit();
        bump();
        scheduleSync();
      },

      // Crear tarea offline (P6-3): put sobre `tasks` (entidad mutable) → optimismo local
      // inmediato + push. El servidor (TaskSyncHandler) sanea (fuerza general/pending); se
      // envían esos valores para dejar el row local completo. type='health'/related_* son
      // reservados del servidor y no se envían.
      captureTaskCreate: (title: string, opts?: { dueDate?: string | null; priority?: string }) => {
        const d = deviceRef.current;
        if (!d) return;
        const t = title.trim();
        if (!t) return;
        d.setFields('tasks', Crypto.randomUUID(), {
          title: t,
          type: 'general',
          status: 'pending',
          due_date: opts?.dueDate ?? null,
          priority: opts?.priority ?? 'normal',
          description: null,
          related_type: null,
          related_id: null,
          completed_at: null,
        });
        d.commit();
        bump();
        scheduleSync();
      },

      // Completar tarea offline (P6-3): put status='done' + completed_at del device (D2).
      // El row local pasa a done al instante; el handler aplica pending→done (done→done no-op).
      captureTaskComplete: (taskId: string) => {
        const d = deviceRef.current;
        if (!d) return;
        d.setFields('tasks', taskId, { status: 'done', completed_at: new Date().toISOString() });
        d.commit();
        bump();
        scheduleSync();
      },

      captureWeighing: (animalId: string, kg: number, cc?: number) => {
        const d = deviceRef.current;
        if (!d) return;
        const now = new Date().toISOString();
        d.addEvent('weighings', Crypto.randomUUID(), {
          animal_id: animalId,
          weight_kg: kg,
          body_condition: cc ?? null,
          weighed_at: now,
        });
        d.addEvent('animal_events', Crypto.randomUUID(), {
          animal_id: animalId,
          event_type: 'weighing',
          payload: { weight_kg: kg, body_condition: cc ?? null },
          occurred_at: now,
        });
        // Actualiza el "último peso" local (campo de presentación, LWW)
        d.setFields('animals', animalId, { last_weight_kg: kg, last_weighed_at: now });
        d.commit();
        bump();
        scheduleSync();
      },

      pendingDetail: () => {
        const d = deviceRef.current;
        if (!d) return [];
        const tagOf = (animalId: unknown) => {
          if (typeof animalId !== 'string') return undefined;
          const st = store()?.getRow('animals', animalId);
          return (st?.fields.visual_tag as string) ?? undefined;
        };
        const items: PendingItem[] = [];
        for (const cs of d.pendingChangesets) {
          for (const op of cs.ops) {
            let summary = '';
            let tag: string | undefined;
            if (op.kind === 'event') {
              const row = op.row;
              tag = tagOf(row.animal_id ?? row.dam_id);
              if (op.table === 'weighings') summary = `Pesaje · ${row.weight_kg} kg`;
              else if (op.table === 'vaccinations') summary = 'Vacunación';
              else if (op.table === 'treatments') summary = 'Tratamiento';
              else if (op.table === 'mortalities') summary = 'Baja por muerte';
              else if (op.table === 'weanings') summary = 'Destete';
              else if (op.table === 'breeding_events')
                summary = row.type === 'heat' ? 'Celo' : String(row.type).startsWith('service') ? 'Servicio' : 'Evento reproductivo';
              else if (op.table === 'calvings') summary = 'Parto';
              else if (op.table === 'calving_offspring') continue; // detalle interno del parto
              else if (op.table === 'animal_events') {
                if (row.event_type === 'note') summary = 'Nota';
                else continue; // espejo del timeline de otras capturas, no repetir
              } else summary = op.table;
            } else {
              if (op.table === 'animals') {
                tag = (op.fields.visual_tag as string) ?? tagOf(op.rowId);
                summary = op.fields.visual_tag ? 'Alta de animal' : 'Cambios del animal';
              } else if (op.table === 'pregnancies') {
                tag = tagOf(op.fields.animal_id) ?? tagOf(op.rowId);
                summary =
                  op.fields.status === 'open'
                    ? 'Diagnóstico de preñez'
                    : op.fields.status === 'calved'
                      ? 'Cierre de preñez (parto)'
                      : 'Cambio de preñez';
              } else summary = op.table;
            }
            items.push({ seq: cs.seq, summary, tag });
          }
        }
        return items;
      },

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
  }, [status, errorMsg, version, offlineSim, syncing, lastSyncResult, syncNow, setOfflineSim, scheduleSync, init, login, logout, authFetch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
