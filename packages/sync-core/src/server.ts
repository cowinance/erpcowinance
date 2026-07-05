import { applyPut, detectTerminalStatusConflict } from './merge';
import { MemStore } from './store';
import { Changeset, PullResult, PushResult, SyncConflict } from './types';

/**
 * Núcleo del servidor de sincronización (independiente de la persistencia).
 * Mantiene la réplica canónica, el log ordenado de changesets (cursor global)
 * y la detección de conflictos. La API HTTP (apps/api) implementa esta misma
 * lógica sobre Postgres; aquí vive la versión de referencia usada por la
 * suite de simulación.
 */
export class SyncServerCore {
  readonly store = new MemStore();
  readonly log: { serverSeq: number; changeset: Changeset }[] = [];
  readonly conflicts: SyncConflict[] = [];
  private seenByDevice = new Map<string, Set<number>>();
  /** Detección de duplicados de campo: caravana visual → animal que la usa. */
  private tagOwner = new Map<string, string>();
  private serverSeq = 0;

  push(changesets: Changeset[]): PushResult {
    let accepted = 0;
    let deduped = 0;
    const newConflicts: SyncConflict[] = [];

    for (const cs of [...changesets].sort((a, b) => a.seq - b.seq)) {
      if (!this.seenByDevice.has(cs.deviceId)) this.seenByDevice.set(cs.deviceId, new Set());
      const seen = this.seenByDevice.get(cs.deviceId)!;
      if (seen.has(cs.seq)) {
        deduped++; // reintento del cliente: exactly-once lógico
        continue;
      }
      seen.add(cs.seq);

      for (const op of cs.ops) {
        if (op.kind === 'put') {
          const prev = this.store.getRow(op.table, op.rowId);

          const semantic = detectTerminalStatusConflict(prev, op);
          if (semantic) {
            newConflicts.push({ type: 'semantic', table: op.table, rowId: op.rowId, detail: semantic, changesetId: cs.id });
          }
          if (op.table === 'animals' && typeof op.fields['visual_tag'] === 'string') {
            const tag = op.fields['visual_tag'] as string;
            const owner = this.tagOwner.get(tag);
            if (owner && owner !== op.rowId) {
              newConflicts.push({
                type: 'duplicate',
                table: op.table,
                rowId: op.rowId,
                detail: `Caravana '${tag}' creada en dos dispositivos (animal existente ${owner}) — propuesta de fusión`,
                changesetId: cs.id,
              });
            } else {
              this.tagOwner.set(tag, op.rowId);
            }
          }

          const { state } = applyPut(prev, op);
          this.store.putRow(op.table, op.rowId, state);
        } else {
          if (!this.store.hasEvent(op.table, op.rowId)) {
            this.store.addEvent(op.table, op.rowId, op.row);
          }
        }
      }

      this.serverSeq++;
      this.log.push({ serverSeq: this.serverSeq, changeset: cs });
      accepted++;
    }

    this.conflicts.push(...newConflicts);
    return { accepted, deduped, conflicts: newConflicts, serverCursor: this.serverSeq };
  }

  pull(afterCursor: number, excludeDevice?: string): PullResult {
    const changesets = this.log
      .filter((e) => e.serverSeq > afterCursor && e.changeset.deviceId !== excludeDevice)
      .map((e) => ({ serverSeq: e.serverSeq, changeset: e.changeset }));
    return { changesets, cursor: this.serverSeq };
  }
}
