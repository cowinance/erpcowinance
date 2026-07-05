/**
 * Adaptador NATIVO (iOS/Android): SQLite con escrituras incrementales.
 * Cada mutación del dispositivo (fila, evento, changeset en cola, cursor)
 * se persiste en el momento — la base local escala a decenas de miles de
 * registros sin serializar snapshots completos.
 */
import * as SQLite from 'expo-sqlite';
import type { Changeset, DeviceMutation, SerializedDevice, SyncDevice } from '@cowinance/sync-core';
import type { DeviceStorage, PersistedMeta } from './storage.types';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rows (
    table_name TEXT NOT NULL, row_id TEXT NOT NULL,
    fields TEXT NOT NULL, versions TEXT NOT NULL,
    PRIMARY KEY (table_name, row_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    table_name TEXT NOT NULL, event_id TEXT NOT NULL, row TEXT NOT NULL,
    PRIMARY KEY (table_name, event_id)
  );
  CREATE TABLE IF NOT EXISTS pending (seq INTEGER PRIMARY KEY, changeset TEXT NOT NULL);
`;

export function createStorage(): DeviceStorage {
  let db: SQLite.SQLiteDatabase | null = null;
  // Cola de escritura: serializa las mutaciones para preservar el orden
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    queue = queue.then(fn, fn);
  };

  const setKv = (k: string, v: string) => db!.runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, v);
  const getKv = async (k: string) => (await db!.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k))?.v ?? null;

  const write = async (m: DeviceMutation) => {
    if (!db) return;
    switch (m.kind) {
      case 'row':
        await db.runAsync(
          'INSERT OR REPLACE INTO rows (table_name, row_id, fields, versions) VALUES (?, ?, ?, ?)',
          m.table,
          m.rowId,
          JSON.stringify(m.state.fields),
          JSON.stringify(m.state.versions),
        );
        break;
      case 'event':
        await db.runAsync(
          'INSERT OR REPLACE INTO events (table_name, event_id, row) VALUES (?, ?, ?)',
          m.table,
          m.eventId,
          JSON.stringify(m.row),
        );
        break;
      case 'queued':
        await db.runAsync('INSERT OR REPLACE INTO pending (seq, changeset) VALUES (?, ?)', m.changeset.seq, JSON.stringify(m.changeset));
        await setKv('seq', String(m.seq));
        await setKv('cs_counter', String(m.csCounter));
        break;
      case 'flushed':
        if (m.seqs.length)
          await db.runAsync(`DELETE FROM pending WHERE seq IN (${m.seqs.map(() => '?').join(',')})`, ...m.seqs);
        break;
      case 'cursor':
        await setKv('cursor', String(m.cursor));
        break;
    }
  };

  return {
    engine: 'SQLite',
    async init() {
      db = await SQLite.openDatabaseAsync('cowinance.db');
      await db.execAsync(SCHEMA);
    },
    async loadMeta() {
      const raw = await getKv('meta');
      return raw ? (JSON.parse(raw) as PersistedMeta) : null;
    },
    async saveMeta(meta) {
      enqueue(() => setKv('meta', JSON.stringify(meta)));
      await queue;
    },
    async loadDevice() {
      const deviceId = await getKv('device_id');
      if (!deviceId) return null;
      const [rows, events, pending, seq, csCounter, cursor] = await Promise.all([
        db!.getAllAsync<{ table_name: string; row_id: string; fields: string; versions: string }>('SELECT * FROM rows'),
        db!.getAllAsync<{ table_name: string; event_id: string; row: string }>('SELECT * FROM events'),
        db!.getAllAsync<{ changeset: string }>('SELECT changeset FROM pending ORDER BY seq'),
        getKv('seq'),
        getKv('cs_counter'),
        getKv('cursor'),
      ]);
      const serialized: SerializedDevice = {
        deviceId,
        seq: Number(seq ?? 0),
        csCounter: Number(csCounter ?? 0),
        cursor: Number(cursor ?? 0),
        pending: pending.map((p) => JSON.parse(p.changeset) as Changeset),
        rows: {},
        events: {},
      };
      for (const r of rows) {
        (serialized.rows[r.table_name] ??= {})[r.row_id] = { fields: JSON.parse(r.fields), versions: JSON.parse(r.versions) };
      }
      for (const e of events) {
        (serialized.events[e.table_name] ??= {})[e.event_id] = JSON.parse(e.row);
      }
      return serialized;
    },
    attach(device) {
      enqueue(() => setKv('device_id', device.deviceId));
      device.listener = (m) => enqueue(() => write(m));
    },
    async reset() {
      if (!db) return;
      await db.execAsync('DELETE FROM kv; DELETE FROM rows; DELETE FROM events; DELETE FROM pending;');
    },
  };
}
