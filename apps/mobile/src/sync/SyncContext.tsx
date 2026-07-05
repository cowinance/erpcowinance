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
import { SyncDevice, Changeset, PushResult, PullResult } from '@cowinance/sync-core';
import { createStorage } from './storage';
import type { DeviceStorage, PersistedMeta } from './storage.types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const AUTO_SYNC_INTERVAL_MS = 60_000;
const POST_CAPTURE_DEBOUNCE_MS = 2_500;

const GESTATION_DAYS = 283;

export interface AnimalRow {
  id: string;
  tag?: string;
  name?: string;
  status?: string;
  sex?: string;
  category?: string;
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
  openPregnancy: (animalId: string) => LocalPregnancy | null;
  captureWeighing: (animalId: string, kg: number, cc?: number) => void;
  captureVaccination: (animalId: string, productId: string, dose?: number, batch?: string) => void;
  captureTreatment: (animalId: string, productId: string, dose?: number, route?: string) => { meatUntil: string | null };
  captureHeat: (animalId: string) => void;
  captureService: (animalId: string, method: 'ai' | 'natural', sireId?: string) => void;
  captureDiagnosis: (animalId: string, result: 'pregnant' | 'empty') => { expectedDue?: string };
  captureCalving: (damId: string, calf: { sex: 'F' | 'M'; tag?: string }) => { calfId: string };
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

function rowToAnimal(id: string, fields: Record<string, unknown>): AnimalRow {
  return {
    id,
    tag: fields.visual_tag as string,
    name: (fields.name as string) ?? undefined,
    status: fields.status as string,
    sex: fields.sex as string,
    category: fields.category as string,
    lot_name: fields.lot_name as string,
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
        const j = await res.json();
        return {
          cursor: j.cursor,
          changesets: j.changesets.map((c: any) => ({
            serverSeq: c.server_seq,
            changeset: { id: c.id, deviceId: c.device_id, seq: c.seq, hlc: c.hlc, schemaVersion: c.schema_version, ops: c.ops },
          })),
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
      metaRef.current = { ...metaRef.current, lastSyncAt: new Date().toISOString() };
      await storageRef.current.saveMeta(metaRef.current);
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
  }, [transport]);

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
      metaRef.current = { ...metaRef.current, serverDeviceId: device.id, farmName: snapshot.farm?.name, lastSyncAt: new Date().toISOString() };
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
        metaRef.current = {
          ...metaRef.current,
          accessToken: j.access_token,
          refreshToken: j.refresh_token,
          userName: j.user?.name,
          userEmail: j.user?.email,
        };
        await storageRef.current.saveMeta(metaRef.current!);
        setStatus('boot');
        await init();
        return null;
      } catch (e: any) {
        return `Sin conexión con la API (${e.message})`;
      }
    },
    [init],
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

    return {
      status,
      errorMsg,
      userName: metaRef.current?.userName,
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
          const a = rowToAnimal(id, st.fields);
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
        return st ? rowToAnimal(id, st.fields) : null;
      },

      findByTag: (tag: string) => {
        const m = store()?.rows.get('animals');
        if (!m) return null;
        for (const [id, st] of m) {
          if (st.fields.status === 'active' && String(st.fields.visual_tag ?? '') === tag.trim()) return rowToAnimal(id, st.fields);
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
          if (st.fields.status === 'active' && st.fields.category_code === 'toro') list.push(rowToAnimal(id, st.fields));
        }
        return list;
      },

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
        const meatUntil = product?.withdrawal_meat_days
          ? new Date(now.getTime() + product.withdrawal_meat_days * 86400000).toISOString().slice(0, 10)
          : null;
        const milkUntil = product?.withdrawal_milk_hours
          ? new Date(now.getTime() + product.withdrawal_milk_hours * 3600000).toISOString()
          : null;
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
          const expectedDue = new Date((serviceAt ?? new Date(now.getTime() - 45 * 86400000)).getTime() + GESTATION_DAYS * 86400000)
            .toISOString()
            .slice(0, 10);
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
        d.setFields('animals', calfId, {
          visual_tag: calf.tag ?? null,
          name: null,
          status: 'active',
          sex: calf.sex,
          birth_date: today,
          category: calf.sex === 'M' ? 'Ternero' : 'Ternera',
          category_code: calf.sex === 'M' ? 'ternero' : 'ternera',
          dam_id: damId,
          lot_name: dam?.lot_name ?? null,
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
              else if (op.table === 'breeding_events')
                summary = row.type === 'heat' ? 'Celo' : String(row.type).startsWith('service') ? 'Servicio' : 'Evento reproductivo';
              else if (op.table === 'calvings') summary = 'Parto';
              else if (op.table === 'calving_offspring') continue; // detalle interno del parto
              else if (op.table === 'animal_events') continue; // espejo del timeline, no repetir
              else summary = op.table;
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
