/**
 * Builders PUROS del emit de captura (P5-2). Cada uno produce EXACTAMENTE un event op
 * `{ table, rowId, row }` que las closures de `SyncContext` pasan tal cual a
 * `d.addEvent(table, rowId, row)`. No hay abstracción genérica: tres helpers específicos,
 * cada uno con el invariante de su dominio.
 *
 * Patrón B (event-only): mortalidad y destete emiten SOLO su event de dominio — el
 * servidor (recordMortality/recordWeaning) autora hecho + timeline (+ server-origin de
 * `status` en mortalidad). NADA de `animal_events` compañero ni `put`s. La nota SÍ es un
 * `animal_events` (no hay tabla de dominio) → un único op.
 *
 * Módulo puro, sin dependencias de React Native / Expo (testeable en node): el `rowId`
 * (uuid, identidad de la intención) y el instante `now` se INYECTAN para determinismo en
 * los unit tests; las closures reales pasan `Crypto.randomUUID` y `new Date()`.
 */

export interface EmitOp {
  table: string;
  rowId: string;
  row: Record<string, unknown>;
}

/** Fecha LOCAL `YYYY-MM-DD` (sin corrimiento de timezone al slicear en el servidor). */
function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Mortalidad: un event op sobre `mortalities`. `died_at` conserva el INSTANTE real de la
 * captura offline. Sin `animal_events` compañero ni put de `status` (Patrón B).
 */
export function buildMortalityEmit(animalId: string, notes: string | undefined, now: Date, newId: () => string): EmitOp {
  return {
    table: 'mortalities',
    rowId: newId(),
    row: { animal_id: animalId, died_at: now.toISOString(), necropsy: false, estimated_loss: null, notes: notes ?? null },
  };
}

/**
 * Destete: un event op sobre `weanings`. `weaning_date` en formato LOCAL `YYYY-MM-DD` (el
 * que espera `recordWeaning`, sin depender del timezone al sincronizar). `weight_kg` SOLO
 * cuando se proporciona; el pesaje asociado lo materializa atómicamente el servidor.
 */
export function buildWeaningEmit(animalId: string, weightKg: number | undefined, now: Date, newId: () => string): EmitOp {
  const row: Record<string, unknown> = { animal_id: animalId, weaning_date: localDate(now) };
  if (weightKg != null) row.weight_kg = weightKg;
  return { table: 'weanings', rowId: newId(), row };
}

/**
 * Nota: un event op sobre `animal_events` con `event_type:'note'` y `payload:{ text }`.
 * Devuelve `null` si el texto queda vacío tras `trim` → la closure no emite.
 */
export function buildNoteEmit(animalId: string, text: string, now: Date, newId: () => string): EmitOp | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    table: 'animal_events',
    rowId: newId(),
    row: { animal_id: animalId, event_type: 'note', payload: { text: trimmed }, occurred_at: now.toISOString() },
  };
}
