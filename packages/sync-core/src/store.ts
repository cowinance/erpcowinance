import { RowState } from './types';

/**
 * Almacén en memoria de estados versionados y eventos.
 * Lo usan los dispositivos simulados y la réplica canónica del servidor de
 * simulación; la persistencia real (SQLite en móvil, Postgres en servidor)
 * implementa esta misma semántica.
 */
export class MemStore {
  /** table → rowId → RowState */
  rows = new Map<string, Map<string, RowState>>();
  /** table → eventId → row */
  events = new Map<string, Map<string, Record<string, unknown>>>();

  getRow(table: string, rowId: string): RowState | undefined {
    return this.rows.get(table)?.get(rowId);
  }

  putRow(table: string, rowId: string, state: RowState): void {
    if (!this.rows.has(table)) this.rows.set(table, new Map());
    this.rows.get(table)!.set(rowId, state);
  }

  hasEvent(table: string, eventId: string): boolean {
    return this.events.get(table)?.has(eventId) ?? false;
  }

  addEvent(table: string, eventId: string, row: Record<string, unknown>): void {
    if (!this.events.has(table)) this.events.set(table, new Map());
    this.events.get(table)!.set(eventId, row);
  }

  /** Huella canónica del estado completo (para verificar convergencia). */
  fingerprint(): string {
    const canon: Record<string, unknown> = {};
    for (const table of [...this.rows.keys()].sort()) {
      const rows: Record<string, unknown> = {};
      const m = this.rows.get(table)!;
      for (const id of [...m.keys()].sort()) {
        const st = m.get(id)!;
        rows[id] = { f: sortObj(st.fields), v: sortObj(st.versions) };
      }
      canon[`rows:${table}`] = rows;
    }
    for (const table of [...this.events.keys()].sort()) {
      const evs: Record<string, unknown> = {};
      const m = this.events.get(table)!;
      for (const id of [...m.keys()].sort()) evs[id] = sortObj(m.get(id)!);
      canon[`events:${table}`] = evs;
    }
    return JSON.stringify(canon);
  }
}

function sortObj(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
