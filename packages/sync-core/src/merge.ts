import { hlcCompare, hlcNode } from './hlc';
import { PutOp, RowState } from './types';

/** Estados terminales del animal: dos hechos terminales concurrentes son un conflicto semántico. */
export const TERMINAL_STATUS = new Set(['dead', 'sold', 'culled', 'lost', 'transferred']);

/**
 * Merge determinista por campo (LWW con HLC).
 * Pura y conmutativa: aplicar las mismas ops en cualquier orden produce el
 * mismo estado → convergencia sin coordinación.
 */
export function applyPut(
  state: RowState | undefined,
  op: PutOp,
): { state: RowState; changed: string[] } {
  const s: RowState = state
    ? { fields: { ...state.fields }, versions: { ...state.versions } }
    : { fields: {}, versions: {} };
  const changed: string[] = [];
  for (const [field, value] of Object.entries(op.fields)) {
    const current = s.versions[field];
    if (!current || hlcCompare(op.hlc, current) > 0) {
      s.fields[field] = value;
      s.versions[field] = op.hlc;
      changed.push(field);
    }
  }
  return { state: s, changed };
}

/**
 * Conflicto semántico de dominio: la op escribe un estado terminal cuando otro
 * nodo ya había escrito un estado terminal. El LWW resuelve determinista;
 * el conflicto va a cola de revisión — nunca se descartan datos en silencio.
 */
export function detectTerminalStatusConflict(prev: RowState | undefined, op: PutOp): string | null {
  const next = op.fields['status'];
  if (typeof next !== 'string' || !TERMINAL_STATUS.has(next)) return null;
  const prevStatus = prev?.fields['status'];
  const prevHlc = prev?.versions['status'];
  if (
    typeof prevStatus === 'string' &&
    TERMINAL_STATUS.has(prevStatus) &&
    prevHlc &&
    hlcNode(prevHlc) !== hlcNode(op.hlc)
  ) {
    return `Estado terminal concurrente: '${prevStatus}' (previo) vs '${next}' (entrante)`;
  }
  return null;
}
