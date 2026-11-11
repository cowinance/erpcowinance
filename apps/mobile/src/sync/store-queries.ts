/**
 * Lecturas del store local, como funciones PURAS.
 *
 * Todo lo que la app muestra sale de acá: el rodeo, el timeline, los catálogos, el retiro
 * efectivo y el detalle de la cola. Antes vivían como closures dentro del `useMemo` del provider,
 * y eso las hacía imposibles de probar sin montar React, Expo y el almacenamiento — por eso no
 * tenían un solo test pese a ser lo que el operario lee en la manga.
 *
 * Módulo sin React ni React Native: el runner de vitest del monorepo lo toma tal cual.
 */
import type { Changeset, MemStore } from '@cowinance/sync-core';
import { latestWithdrawal } from '@cowinance/domain';
import type {
  AnimalEventRow,
  AnimalRow,
  LocalPregnancy,
  LotRow,
  PendingItem,
  TaskRow,
  VetProduct,
} from './sync-types';

/** El store puede no existir todavía (arranque en frío, antes del bootstrap). */
type Store = MemStore | undefined;

/** Nombre del lote desde el catálogo local (M-3.2.b), por `current_lot_id`. */
export function lotNameOf(store: Store, lotId: string): string | undefined {
  return store?.rows.get('lots')?.get(lotId)?.fields.name as string | undefined;
}

export function rowToAnimal(store: Store, id: string, fields: Record<string, unknown>): AnimalRow {
  const currentLotId = (fields.current_lot_id as string) ?? null;
  return {
    id,
    tag: fields.visual_tag as string,
    name: (fields.name as string) ?? undefined,
    status: fields.status as string,
    sex: fields.sex as string,
    category: fields.category as string,
    current_lot_id: currentLotId,
    // El nombre del lote SIEMPRE se resuelve del catálogo por current_lot_id: el put de un
    // movimiento actualiza current_lot_id pero NO el lot_name denormalizado, que quedaría obsoleto.
    lot_name: currentLotId ? lotNameOf(store, currentLotId) : undefined,
    last_weight_kg: fields.last_weight_kg as number,
    last_weighed_at: fields.last_weighed_at as string,
    meat_withdrawal_until: (fields.meat_withdrawal_until as string) ?? null,
    milk_withdrawal_until: (fields.milk_withdrawal_until as string) ?? null,
    open_cases: (fields.open_cases as number) ?? 0,
    case_severity: (fields.case_severity as string) ?? null,
  };
}

export function listAnimals(store: Store, query?: string): AnimalRow[] {
  const m = store?.rows.get('animals');
  if (!m) return [];
  const list: AnimalRow[] = [];
  for (const [id, st] of m) {
    if (st.fields.status !== 'active') continue;
    const a = rowToAnimal(store, id, st.fields);
    if (query) {
      const q = query.toLowerCase();
      if (!a.tag?.toLowerCase().includes(q) && !a.name?.toLowerCase().includes(q)) continue;
    }
    list.push(a);
  }
  return list.sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? '', undefined, { numeric: true }));
}

export function getAnimal(store: Store, id: string): AnimalRow | null {
  const st = store?.getRow('animals', id);
  return st ? rowToAnimal(store, id, st.fields) : null;
}

export function findAnimalByTag(store: Store, tag: string): AnimalRow | null {
  const m = store?.rows.get('animals');
  if (!m) return null;
  for (const [id, st] of m) {
    if (st.fields.status === 'active' && String(st.fields.visual_tag ?? '') === tag.trim()) {
      return rowToAnimal(store, id, st.fields);
    }
  }
  return null;
}

export function listAnimalEvents(store: Store, animalId: string): AnimalEventRow[] {
  const m = store?.events.get('animal_events');
  if (!m) return [];
  const list: AnimalEventRow[] = [];
  for (const [eid, row] of m) {
    if (row.animal_id !== animalId) continue;
    list.push({
      id: eid,
      type: String(row.event_type),
      at: String(row.occurred_at),
      data: (row.payload as Record<string, unknown>) ?? {},
    });
  }
  return list.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function listProducts(store: Store, type?: 'vaccine' | 'other'): VetProduct[] {
  const m = store?.rows.get('products_veterinary');
  if (!m) return [];
  const list: VetProduct[] = [];
  for (const [id, st] of m) {
    const p = { id, ...st.fields } as unknown as VetProduct;
    if (type === 'vaccine' && p.type !== 'vaccine') continue;
    if (type === 'other' && p.type === 'vaccine') continue;
    list.push(p);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function listBulls(store: Store): AnimalRow[] {
  const m = store?.rows.get('animals');
  if (!m) return [];
  const list: AnimalRow[] = [];
  for (const [id, st] of m) {
    if (st.fields.status === 'active' && st.fields.category_code === 'toro') {
      list.push(rowToAnimal(store, id, st.fields));
    }
  }
  return list;
}

/**
 * Catálogo de lotes hidratado en el bootstrap (P3 M-3.1). Colección estable (orden por nombre)
 * y 100% offline: lee del store local, sin red.
 */
export function listLots(store: Store): LotRow[] {
  const m = store?.rows.get('lots');
  if (!m) return [];
  const list: LotRow[] = [];
  for (const [id, st] of m) {
    const f = st.fields;
    list.push({
      id,
      name: String(f.name ?? ''),
      current_paddock_id: (f.current_paddock_id as string) ?? null,
      paddock_name: (f.paddock_name as string) ?? null,
    });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tareas hidratadas por el bootstrap (P6-1.b.2) más las completadas en la sesión (put local).
 * Colección estable, 100% offline: lee del store local (mismo patrón que `listLots`).
 */
export function listTasks(store: Store): TaskRow[] {
  const m = store?.rows.get('tasks');
  if (!m) return [];
  const list: TaskRow[] = [];
  for (const [id, st] of m) {
    const f = st.fields;
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
      assigned_to: (f.assigned_to as string) ?? null,
    });
  }
  return list;
}

export function findOpenPregnancy(store: Store, animalId: string): LocalPregnancy | null {
  const m = store?.rows.get('pregnancies');
  if (!m) return null;
  for (const [id, st] of m) {
    if (st.fields.animal_id === animalId && st.fields.status === 'open') {
      return { id, ...st.fields } as unknown as LocalPregnancy;
    }
  }
  return null;
}

/** Id de la preñez abierta de un animal, o `null`. Lo usan diagnóstico y parto para cerrarla. */
export function openPregnancyId(store: Store, animalId: string): string | null {
  return findOpenPregnancy(store, animalId)?.id ?? null;
}

/**
 * Las categorías se derivan del rodeo bajado y NO de una lista escrita en la app: son un catálogo
 * que cada finca edita en Configuración, así que cualquier lista fija quedaría desactualizada sin
 * que nadie se entere. El costo es que una categoría que la finca todavía no usa no aparece; para
 * el alta rápida alcanza, y lo raro se carga desde la web.
 */
export function listCategoriesInUse(store: Store): { code: string; label: string }[] {
  const vistas = new Map<string, string>();
  const m = store?.rows.get('animals');
  if (m) {
    for (const [, st] of m) {
      const code = st.fields.category_code;
      const label = st.fields.category;
      if (typeof code === 'string' && code && !vistas.has(code)) {
        vistas.set(code, typeof label === 'string' && label ? label : code);
      }
    }
  }
  return [...vistas].map(([code, label]) => ({ code, label })).sort((x, y) => x.label.localeCompare(y.label, 'es'));
}

/**
 * Retiro efectivo: el que trajo el bootstrap (tratamientos de cualquier canal) combinado con los
 * que ESTE dispositivo capturó offline y todavía no subió. La regla de cuál gana vive en el
 * dominio (`latestWithdrawal`), igual que la de las alertas.
 */
export function effectiveWithdrawal(store: Store, animalId: string): { meat: string | null; milk: string | null } {
  const animal = store?.getRow('animals', animalId)?.fields;
  const locales: { meat: (string | null)[]; milk: (string | null)[] } = { meat: [], milk: [] };
  const tratamientos = store?.events.get('treatments');
  if (tratamientos) {
    for (const [, row] of tratamientos) {
      if (row.animal_id !== animalId) continue;
      locales.meat.push((row.meat_withdrawal_until as string) ?? null);
      locales.milk.push((row.milk_withdrawal_until as string) ?? null);
    }
  }
  return {
    meat: latestWithdrawal((animal?.meat_withdrawal_until as string) ?? null, ...locales.meat),
    milk: latestWithdrawal((animal?.milk_withdrawal_until as string) ?? null, ...locales.milk),
  };
}

/**
 * ¿Esta capacidad está otorgada? Resuelta contra la matriz que trajo el bootstrap, así que
 * contesta SIN SEÑAL. No es un control de seguridad —el servidor revalida cada push contra la
 * misma matriz—: sirve para no ofrecer un botón cuya captura offline va a ser rechazada.
 *
 * Sin capacidades conocidas (bootstrap viejo, anterior a que esto existiera) devuelve `true`: es
 * preferible ofrecer de más y que el servidor rechace, a dejar una app instalada sin un solo botón
 * después de actualizar.
 */
export function tieneCapacidad(
  caps: Record<string, string> | undefined,
  cap: string,
  access: 'read' | 'write' = 'write',
): boolean {
  if (!caps) return true;
  const otorgado = caps[cap];
  if (!otorgado) return false;
  return otorgado === 'write' || access === 'read';
}

/**
 * Qué hay en la cola, en palabras. Es la pantalla que mira alguien que capturó sin señal y
 * necesita saber que su trabajo sigue ahí, así que cada línea nombra el hecho y el animal.
 *
 * Dos omisiones deliberadas: `calving_offspring` es detalle interno del parto, y los
 * `animal_events` que acompañan a otra captura son el espejo del timeline — listarlos duplicaría
 * cada pesaje y cada tratamiento. La nota sí aparece, porque ahí el animal_events ES el hecho.
 */
export function describePending(pending: readonly Changeset[], store: Store): PendingItem[] {
  const tagOf = (animalId: unknown): string | undefined => {
    if (typeof animalId !== 'string') return undefined;
    return (store?.getRow('animals', animalId)?.fields.visual_tag as string) ?? undefined;
  };
  const items: PendingItem[] = [];
  for (const cs of pending) {
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
        else if (op.table === 'calving_offspring') continue;
        else if (op.table === 'animal_events') {
          if (row.event_type === 'note') summary = 'Nota';
          else continue;
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
}
