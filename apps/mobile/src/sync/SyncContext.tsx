/**
 * Motor offline-first del cliente móvil (doc Arquitectura §6.1, §12):
 * la UI lee y escribe SOLO contra el store local (SyncDevice de
 * @cowinance/sync-core). Persistencia incremental vía DeviceStorage
 * (SQLite en nativo, AsyncStorage en web) y sincronización automática:
 * al arrancar, tras cada captura (debounce) y cada 60 s en primer plano.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
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
import { useNotificaciones } from './use-notificaciones';
import type { PulledChangesetWire, ServerConflict, SyncCtx } from './sync-types';
import { type CachedNotification, countUnread, reconcileView } from './notification-cache';
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
  const [almacen] = useState<DeviceStorage>(createStorage);
  const deviceRef = useRef<SyncDevice | null>(null);
  /**
   * La meta vive en DOS lugares a propósito, y una sola función escribe los dos.
   *
   * El ref es lo que leen los caminos asíncronos —authFetch, syncNow, el refresh de
   * notificaciones—, donde hace falta el valor más reciente sin esperar a que React vuelva a
   * dibujar. El estado es lo que lee el render.
   *
   * Antes solo existía el ref y el render lo leía directo, manteniéndose al día con un contador
   * manual (`bump()`). Funcionaba mientras nadie se olvidara de llamarlo: una mutación sin bump
   * dejaba la pantalla mostrando datos viejos sin ningún síntoma. Con el estado de por medio esa
   * clase de error desaparece.
   */
  const metaRef = useRef<PersistedMeta | null>(null);
  const [metaVisible, setMetaVisible] = useState<PersistedMeta | null>(null);
  const offlineRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<'boot' | 'login' | 'ready' | 'error'>('boot');
  const [errorMsg, setErrorMsg] = useState<string>();
  const [version, setVersion] = useState(0);
  const [offlineSim, setOfflineSimState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncResult, setLastSyncResult] = useState<string>();
  /**
   * Lo que el disco NO pudo guardar. Null mientras todo escriba bien, que es siempre salvo
   * problema real del dispositivo.
   *
   * Esto no se puede arreglar desde la app —si no hay espacio, no hay espacio—, así que lo único
   * honesto es avisar a tiempo: mientras la app siga abierta lo capturado está en memoria y se
   * puede sincronizar; si se cierra, se pierde.
   */
  const [falloDePersistencia, setFalloDePersistencia] = useState<{ fallos: number; detalle: string } | null>(null);
  /**
   * Avisa que algo cambió por fuera de React. Estable a propósito: viaja como dependencia de casi
   * todos los callbacks del provider, y si cambiara de identidad en cada render los arrastraría a
   * todos con él.
   */
  const bump = useCallback(() => {
    // El contador de pendientes también sale del dispositivo, que es mutable: se refresca acá,
    // en el mismo punto en que ya se avisaba que algo cambió.
    setPendingCount(deviceRef.current?.pendingCount ?? 0);
    setVersion((v) => v + 1);
  }, []);

  /** Única forma de cambiar la meta: escribe el ref (lectores asíncronos) y el estado (render). */
  const aplicarMeta = useCallback((next: PersistedMeta | null) => {
    metaRef.current = next;
    setMetaVisible(next);
  }, []);

  const pushConflictsRef = useRef(0);

  /**
   * UNA sola rotación de refresh a la vez. Las demás esperan a la que ya está en vuelo.
   *
   * El refresh del servidor es de un solo uso y **detecta el reuso**: si llega dos veces el mismo
   * token, asume robo y revoca TODAS las sesiones del usuario (`auth.refresh_reused`). Eso del
   * lado del servidor está bien y no se toca.
   *
   * El problema era de este lado. El token de acceso dura 15 minutos y había cuatro disparadores
   * de sincronización sin candado —el temporizador de 60 s, la vuelta al primer plano, el debounce
   * tras capturar y el botón—, más la agenda y las notificaciones. Dos peticiones que recibieran
   * 401 a la vez leían el MISMO `refreshToken` y lo mandaban las dos: la segunda hacía saltar la
   * detección de reuso y la persona quedaba afuera de todos lados.
   *
   * En el campo eso es lo peor que puede pasar: vuelve la señal después de dos horas en el
   * potrero, la app pasa a primer plano, y en vez de subir el día pide la contraseña.
   */
  const refrescoRef = useRef<Promise<boolean> | null>(null);
  const rotarSesion = useCallback((): Promise<boolean> => {
    if (refrescoRef.current) return refrescoRef.current;
    const token = metaRef.current?.refreshToken;
    if (!token) return Promise.resolve(false);
    const intento = (async () => {
      try {
        const r = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: token }),
        });
        if (!r.ok) return false;
        const j = await r.json();
        aplicarMeta({ ...metaRef.current, accessToken: j.access_token, refreshToken: j.refresh_token });
        // Se persiste ANTES de volver a usarlo: si la app muere acá, al abrir tiene el token nuevo
        // y no el que el servidor ya consumió.
        await almacen.saveMeta(metaRef.current!);
        return true;
      } catch {
        return false; // sin señal: no es una sesión inválida, es que no se pudo preguntar
      } finally {
        refrescoRef.current = null;
      }
    })();
    refrescoRef.current = intento;
    return intento;
  }, [almacen, aplicarMeta]);

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
      if (await rotarSesion()) res = await doFetch();
    }
    if (res.status === 401) {
      aplicarMeta({ ...metaRef.current, accessToken: undefined, refreshToken: undefined });
      await almacen.saveMeta(metaRef.current!);
      setStatus('login');
    }
    return res;
  }, [almacen, aplicarMeta, rotarSesion]);

  /**
   * Única función de mutación/persistencia de meta (D8): el mutator parte SIEMPRE del valor
   * más reciente de metaRef, evitando el read-modify-write sobre snapshots obsoletos cuando
   * syncNow, la pantalla y taps rápidos concurren. No hay store nuevo.
   */
  const persistMeta = useCallback(async (mutate: (prev: PersistedMeta) => PersistedMeta) => {
    if (!metaRef.current) return;
    aplicarMeta(mutate(metaRef.current));
    await almacen.saveMeta(metaRef.current);
  }, [almacen, aplicarMeta]);

  const { refreshNotifications, markNotificationRead, syncPushToken, scheduleNotificationsRefresh } =
    useNotificaciones({ authFetch, persistMeta, metaRef, offlineRef, bump, debounceMs: POST_CAPTURE_DEBOUNCE_MS });

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

  /**
   * Una sincronización a la vez. Quien llegue mientras hay una en vuelo se cuelga de esa.
   *
   * `syncing` es estado de render, no un candado: cuatro disparadores —el temporizador de 60 s, la
   * vuelta al primer plano, el debounce tras capturar y el botón— podían solaparse. Dos vueltas
   * simultáneas no se pisaban los datos (la cola ya se filtra por lo enviado), pero duplicaban el
   * uso de radio y, sobre todo, eran la forma de hacer saltar la detección de reuso del refresh
   * y dejar a la persona sin sesión. Ver `rotarSesion`.
   */
  const syncEnVueloRef = useRef<Promise<{ pushed: number; pulled: number } | { error: string }> | null>(null);

  const syncNow = useCallback((): Promise<{ pushed: number; pulled: number } | { error: string }> => {
    const d = deviceRef.current;
    if (!d || !metaRef.current) return Promise.resolve({ error: 'sin dispositivo' });
    if (offlineRef.current) {
      const msg = 'Sin señal (simulada) — los registros quedan en cola';
      setLastSyncResult(msg);
      return Promise.resolve({ error: msg });
    }
    if (syncEnVueloRef.current) return syncEnVueloRef.current;
    const corrida = (async () => {
      setSyncing(true);
      pushConflictsRef.current = 0;
      try {
        const result = await d.sync(transport);
        // Cache-on-sync de la agenda (P4-2), best-effort: si el fetch falla se conserva el
        // snapshot anterior — el sync (push/pull) ya fue exitoso y la agenda es secundaria.
        let agenda = metaRef.current?.agenda;
        let agendaAt = metaRef.current?.agendaAt;
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
        syncEnVueloRef.current = null;
      }
    })();
    syncEnVueloRef.current = corrida;
    return corrida;
  }, [transport, authFetch, persistMeta, refreshNotifications, bump]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!offlineRef.current) syncNow();
    }, POST_CAPTURE_DEBOUNCE_MS);
  }, [syncNow]);

  const init = useCallback(async () => {
    try {
      const storage = almacen;
      await storage.init();
      const [meta, saved] = await Promise.all([storage.loadMeta(), storage.loadDevice()]);
      aplicarMeta(meta);
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
      const nueva: PersistedMeta = {
        ...metaRef.current,
        serverDeviceId: device.id,
        farmName: snapshot.farm?.name,
        farmId: snapshot.farm?.id,
        farmTimeZone: snapshot.farm?.timezone ?? undefined,
        capabilities: snapshot.capabilities ?? undefined,
        lastSyncAt: new Date().toISOString(),
      };
      aplicarMeta(nueva);
      // Antes de `setStatus('ready')`: a partir de ahí se puede capturar, y capturar FECHA.
      setFarmTimeZone(nueva.farmTimeZone);
      await storage.saveMeta(nueva);
      setStatus('ready');
      bump();
    } catch (e: any) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }, [authFetch, almacen, aplicarMeta, bump]);

  useEffect(() => {
    // Carga asíncrona: el `setState` ocurre DESPUÉS del primer `await`, no mientras corre el
    // efecto. La regla no puede ver a través del await y lo reporta igual.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    init();
  }, [init]);

  // El almacenamiento avisa cuando una escritura no entró; de ahí sale la advertencia en pantalla.
  useEffect(() => {
    return almacen.alFallarEscritura((fallos, detalle) => setFalloDePersistencia({ fallos, detalle }));
  }, [almacen]);

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
  }, [almacen]);

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
    [init, savedPendingCount, almacen, aplicarMeta],
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
    [authFetch, init, savedPendingCount, almacen, aplicarMeta],
  );

  const logout = useCallback(async () => {
    if (metaRef.current?.refreshToken) {
      fetch(`${API_URL}/auth/logout`, {
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
  }, [almacen, aplicarMeta]);

  /**
   * Sync automático: al quedar listo, cada 60 s MIENTRAS LA APP ESTÁ ADELANTE, y al volver a ella.
   *
   * Lo del primer plano no estaba, aunque el encabezado de este archivo lo decía. En iOS el
   * sistema congela los timers al pasar a segundo plano y la diferencia no se notaba; en Android
   * no, así que el teléfono en el bolsillo seguía despertando la radio cada minuto toda la
   * jornada. En un día de campo con batería al 10% eso importa más que la frescura del dato: si
   * nadie está mirando la pantalla, nada de lo que llegue se va a leer.
   *
   * Al volver al primer plano se sincroniza enseguida, así que lo que se ve está al día igual —
   * lo que se saca es el trabajo que no servía a nadie.
   */
  useEffect(() => {
    if (status !== 'ready') return;

    let intervalo: ReturnType<typeof setInterval> | null = null;
    const arrancar = () => {
      if (intervalo) return;
      intervalo = setInterval(() => {
        if (!offlineRef.current) syncNow();
      }, AUTO_SYNC_INTERVAL_MS);
    };
    const parar = () => {
      if (!intervalo) return;
      clearInterval(intervalo);
      intervalo = null;
    };

    // El primer sync sale en un turno aparte y no en el cuerpo del efecto: syncNow() pone
    // 'sincronizando' de entrada, y hacerlo durante el montaje encadena un render más justo
    // cuando la pantalla recién aparece. No hay apuro — el resultado tarda una ida al servidor.
    const primero = setTimeout(() => {
      if (!offlineRef.current) syncNow();
    }, 0);
    arrancar();

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        if (!offlineRef.current) syncNow();
        arrancar();
      } else {
        parar();
      }
    });

    return () => {
      clearTimeout(primero);
      parar();
      sub.remove();
    };
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
      userName: metaVisible?.userName,
      userEmail: metaVisible?.userEmail,
      userId: metaVisible?.userId,
      authFetch,
      login,
      logout,
      organizations: metaVisible?.organizations ?? [],
      tenantId: metaVisible?.tenantId,
      switchOrganization,
      farmName: metaVisible?.farmName,
      // Del módulo de fecha y no de la meta: lo que importa mostrar es la zona que se está USANDO
      // para fechar, no la que quedó guardada. Si difirieran, el diagnóstico mentiría.
      farmTimeZone: getFarmTimeZone(),
      lastSyncAt: metaVisible?.lastSyncAt,
      lastSyncResult,
      storageEngine: almacen.engine,
      falloDePersistencia,
      pendingCount,
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
      agenda: (): AgendaItem[] => metaVisible?.agenda ?? [],
      agendaAt: metaVisible?.agendaAt,

      // Feed in_app cacheado (P7-4.c): vista reconciliada (snapshot + read-set), fuente única
      // para pantalla y badge; usable offline.
      notifications: (): CachedNotification[] => reconcileView(metaVisible?.notifications, metaVisible?.notificationReadPending),
      unreadNotifications: (): number => countUnread(reconcileView(metaVisible?.notifications, metaVisible?.notificationReadPending)),
      notificationsAt: metaVisible?.notificationsAt,
      markNotificationRead,
      refreshNotifications,

      // Registro de push (P7 F2.a): identidad del device + último token confirmado (para el puente
      // nativo) y sincronización del token Expo. La obtención del token y los permisos son nativos.
      serverDeviceId: metaVisible?.serverDeviceId,
      pushLastToken: metaVisible?.lastPushToken,
      syncPushToken,
      scheduleNotificationsRefresh,

      withdrawalOf: (animalId: string) => effectiveWithdrawal(store(), animalId),

      puede: (cap: string, access: 'read' | 'write' = 'write') =>
        tieneCapacidad(metaVisible?.capabilities, cap, access),

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
        await almacen.reset();
        deviceRef.current = null;
        aplicarMeta(null);
        setStatus('boot');
        init();
      },
    };
  }, [status, errorMsg, version, metaVisible, pendingCount, falloDePersistencia, almacen, offlineSim, syncing, lastSyncResult, syncNow, setOfflineSim, scheduleSync, init, login, logout, switchOrganization, authFetch, markNotificationRead, refreshNotifications, scheduleNotificationsRefresh, syncPushToken, aplicarMeta, bump]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
