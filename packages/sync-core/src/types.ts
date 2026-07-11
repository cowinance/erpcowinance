/**
 * Tipos del protocolo de sincronización — doc Arquitectura §12.2.
 * Dos clases de operación, con semántica de resolución distinta:
 *  - put:   atributos de entidad → last-writer-wins POR CAMPO usando HLC
 *  - event: hechos de dominio inmutables (pesajes, tratamientos) → nunca hay
 *           conflicto, solo merge del historial (dedupe por id)
 */

export interface PutOp {
  kind: 'put';
  table: string;
  rowId: string;
  /** Campos escritos por esta operación; todos versionan con el HLC de la op. */
  fields: Record<string, unknown>;
  hlc: string;
}

export interface EventOp {
  kind: 'event';
  table: string;
  rowId: string;
  row: Record<string, unknown>;
  hlc: string;
}

export type Op = PutOp | EventOp;

/** Paquete inmutable de operaciones locales de un dispositivo (unidad de sync). */
export interface Changeset {
  id: string;
  deviceId: string;
  /** Secuencia monotónica por dispositivo → dedupe exactly-once (device, seq). */
  seq: number;
  hlc: string;
  schemaVersion: number;
  ops: Op[];
}

/**
 * Changeset RECIBIDO por pull (contrato remoto). Derivado de `Changeset` para
 * evitar deriva: la ÚNICA diferencia es que la identidad de origen puede ser nula
 * (un changeset de origen servidor — ADR-0016 — viaja con `deviceId`/`seq` en
 * null). El merge del cliente opera sobre `id`/`hlc`/`ops` + `cursor`, no sobre
 * `deviceId`/`seq`. El `Changeset` de autoría/push permanece estricto (no-null).
 */
export type RemoteChangeset = Omit<Changeset, 'deviceId' | 'seq'> & {
  deviceId: string | null;
  seq: number | null;
};

/** Estado versionado de una fila: valor + HLC del último escritor por campo. */
export interface RowState {
  fields: Record<string, unknown>;
  versions: Record<string, string>;
}

export interface SyncConflict {
  type: 'semantic' | 'duplicate' | 'concurrent_update';
  table: string;
  rowId: string;
  detail: string;
  changesetId: string;
}

export interface PushResult {
  accepted: number;
  deduped: number;
  conflicts: SyncConflict[];
  serverCursor: number;
}

export interface PullResult {
  changesets: { serverSeq: number; changeset: RemoteChangeset }[];
  cursor: number;
}
