import { HlcClock } from './hlc';
import { applyPut } from './merge';
import { MemStore } from './store';
import { Changeset, Op, PullResult, PushResult } from './types';

export interface SyncTransport {
  push(changesets: Changeset[]): PushResult | Promise<PushResult>;
  pull(afterCursor: number, excludeDevice?: string): PullResult | Promise<PullResult>;
}

/**
 * Mutación observable del dispositivo — permite persistencia incremental
 * (SQLite escribe solo lo que cambió, sin serializar todo el estado).
 */
export type DeviceMutation =
  | { kind: 'row'; table: string; rowId: string; state: { fields: Record<string, unknown>; versions: Record<string, string> } }
  | { kind: 'event'; table: string; eventId: string; row: Record<string, unknown> }
  | { kind: 'queued'; changeset: Changeset; seq: number; csCounter: number }
  | { kind: 'flushed'; seqs: number[] }
  | { kind: 'cursor'; cursor: number };

/** Snapshot serializable del dispositivo (persistencia local: AsyncStorage/SQLite). */
export interface SerializedDevice {
  deviceId: string;
  seq: number;
  csCounter: number;
  cursor: number;
  pending: Changeset[];
  rows: Record<string, Record<string, { fields: Record<string, unknown>; versions: Record<string, string> }>>;
  events: Record<string, Record<string, Record<string, unknown>>>;
}

/**
 * Motor de cliente offline (base del futuro cliente móvil).
 * La UI escribe SOLO contra el store local; commit() empaqueta las operaciones
 * en un changeset inmutable y sync() converge con el servidor.
 */
export class SyncDevice {
  readonly store = new MemStore();
  readonly clock: HlcClock;
  /** Observador de mutaciones (persistencia incremental). No se invoca en restore(). */
  listener?: (m: DeviceMutation) => void;
  private staged: Op[] = [];
  private pending: Changeset[] = [];
  private seq = 0;
  private csCounter = 0;
  private cursor = 0;

  constructor(
    public readonly deviceId: string,
    now?: () => number,
  ) {
    this.clock = new HlcClock(deviceId, now);
  }

  /** Escritura local de atributos (LWW por campo). */
  setFields(table: string, rowId: string, fields: Record<string, unknown>): void {
    const op: Op = { kind: 'put', table, rowId, fields, hlc: this.clock.tick() };
    this.applyLocal(op);
    this.staged.push(op);
  }

  /** Hecho inmutable (pesaje, tratamiento, evento). */
  addEvent(table: string, rowId: string, row: Record<string, unknown>): void {
    const op: Op = { kind: 'event', table, rowId, row, hlc: this.clock.tick() };
    this.applyLocal(op);
    this.staged.push(op);
  }

  /** Cierra la transacción local en un changeset inmutable. */
  commit(): Changeset | null {
    if (!this.staged.length) return null;
    const cs: Changeset = {
      id: `${this.deviceId}:${++this.csCounter}`,
      deviceId: this.deviceId,
      seq: ++this.seq,
      hlc: this.staged[this.staged.length - 1].hlc,
      schemaVersion: 1,
      ops: this.staged,
    };
    this.staged = [];
    this.pending.push(cs);
    this.listener?.({ kind: 'queued', changeset: cs, seq: this.seq, csCounter: this.csCounter });
    return cs;
  }

  get pendingCount(): number {
    return this.pending.length + (this.staged.length ? 1 : 0);
  }

  /** Cola pendiente de subir (solo lectura — para mostrar el detalle en la UI). */
  get pendingChangesets(): readonly Changeset[] {
    return this.pending;
  }

  /** Push de la cola pendiente + pull de lo remoto. Reanudable e idempotente. */
  async sync(transport: SyncTransport): Promise<{ pushed: number; pulled: number }> {
    if (this.staged.length) this.commit();

    let pushed = 0;
    if (this.pending.length) {
      const flushedSeqs = this.pending.map((c) => c.seq);
      const res = await transport.push(this.pending);
      pushed = res.accepted + res.deduped;
      this.pending = [];
      this.listener?.({ kind: 'flushed', seqs: flushedSeqs });
    }

    const pull = await transport.pull(this.cursor, this.deviceId);
    for (const { changeset } of pull.changesets) {
      this.clock.receive(changeset.hlc);
      for (const op of changeset.ops) this.applyLocal(op);
    }
    this.cursor = pull.cursor;
    this.listener?.({ kind: 'cursor', cursor: this.cursor });
    return { pushed, pulled: pull.changesets.length };
  }

  private applyLocal(op: Op): void {
    if (op.kind === 'put') {
      const { state } = applyPut(this.store.getRow(op.table, op.rowId), op);
      this.store.putRow(op.table, op.rowId, state);
      this.listener?.({ kind: 'row', table: op.table, rowId: op.rowId, state });
    } else if (!this.store.hasEvent(op.table, op.rowId)) {
      this.store.addEvent(op.table, op.rowId, op.row);
      this.listener?.({ kind: 'event', table: op.table, eventId: op.rowId, row: op.row });
    }
  }

  /** Hidratación inicial desde snapshot del servidor (suscripción parcial). */
  hydrate(rows: { table: string; rowId: string; state: { fields: Record<string, unknown>; versions: Record<string, string> } }[], cursor: number): void {
    for (const r of rows) {
      this.store.putRow(r.table, r.rowId, r.state);
      this.listener?.({ kind: 'row', table: r.table, rowId: r.rowId, state: r.state });
    }
    this.cursor = cursor;
    this.listener?.({ kind: 'cursor', cursor });
  }

  serialize(): SerializedDevice {
    const rows: SerializedDevice['rows'] = {};
    for (const [table, m] of this.store.rows) {
      rows[table] = {};
      for (const [id, st] of m) rows[table][id] = st;
    }
    const events: SerializedDevice['events'] = {};
    for (const [table, m] of this.store.events) {
      events[table] = {};
      for (const [id, row] of m) events[table][id] = row;
    }
    return { deviceId: this.deviceId, seq: this.seq, csCounter: this.csCounter, cursor: this.cursor, pending: this.pending, rows, events };
  }

  static restore(data: SerializedDevice, now?: () => number): SyncDevice {
    const d = new SyncDevice(data.deviceId, now);
    d.seq = data.seq;
    d.csCounter = data.csCounter;
    d.cursor = data.cursor;
    d.pending = data.pending ?? [];
    for (const [table, m] of Object.entries(data.rows ?? {}))
      for (const [id, st] of Object.entries(m)) d.store.putRow(table, id, st);
    for (const [table, m] of Object.entries(data.events ?? {}))
      for (const [id, row] of Object.entries(m)) d.store.addEvent(table, id, row);
    return d;
  }
}
