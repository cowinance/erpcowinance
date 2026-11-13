/**
 * Capturas de campo: cada función DEJA PREPARADAS las operaciones de una captura sobre el
 * dispositivo, sin confirmar el changeset ni disparar sincronización. Eso lo hace el provider,
 * que es quien sabe de React y de debounces.
 *
 * El instante (`now`) y los identificadores (`newId`) se INYECTAN, igual que en
 * `capture-builders`: sin eso no hay forma de afirmar nada determinista sobre lo que se emite.
 * Las closures reales pasan `new Date()` y `Crypto.randomUUID`.
 *
 * Módulo sin React ni Expo — testeable en node con el runner del monorepo.
 */
import type { SyncDevice } from '@cowinance/sync-core';
import {
  computeWithdrawal,
  computeExpectedDueDateFromService,
  computeExpectedDueDateFromDiagnosis,
  newbornCategoryCode,
} from '@cowinance/domain';
import { farmToday } from '../lib/date';
import { buildMortalityEmit, buildWeaningEmit, buildNoteEmit } from './capture-builders';
import { openPregnancyId } from './store-queries';

type NewId = () => string;

export function stageWeighing(d: SyncDevice, animalId: string, kg: number, cc: number | undefined, now: Date, newId: NewId): void {
  const at = now.toISOString();
  d.addEvent('weighings', newId(), { animal_id: animalId, weight_kg: kg, body_condition: cc ?? null, weighed_at: at });
  d.addEvent('animal_events', newId(), {
    animal_id: animalId,
    event_type: 'weighing',
    payload: { weight_kg: kg, body_condition: cc ?? null },
    occurred_at: at,
  });
  // Actualiza el «último peso» local (campo de presentación, LWW).
  d.setFields('animals', animalId, { last_weight_kg: kg, last_weighed_at: at });
}

export function stageVaccination(
  d: SyncDevice,
  animalId: string,
  productId: string,
  dose: number | undefined,
  batch: string | undefined,
  now: Date,
  newId: NewId,
): void {
  const at = now.toISOString();
  const product = d.store.getRow('products_veterinary', productId)?.fields;
  d.addEvent('vaccinations', newId(), {
    animal_id: animalId,
    product_id: productId,
    applied_at: at,
    dose: dose ?? null,
    dose_unit: dose ? 'ml' : null,
    batch_number: batch ?? null,
  });
  d.addEvent('animal_events', newId(), {
    animal_id: animalId,
    event_type: 'vaccination',
    payload: { product: (product?.name as string) ?? null, dose: dose ?? null },
    occurred_at: at,
  });
}

/**
 * Tratamiento, con cálculo LOCAL del retiro: el operario necesita saberlo en el campo, sin señal.
 *
 * `timeZone` es la del DISPOSITIVO y se inyecta a propósito. El retiro de carne se cuenta en días
 * de calendario y el teléfono está físicamente en la finca, así que su zona es la de la finca. Sin
 * esto se contaba en UTC y el retiro salía corrido un día — y en un huso positivo, corrido hacia
 * ANTES, que es carne con residuos dada por habilitada.
 *
 * El servidor sigue siendo la autoridad y recalcula con la zona de la organización; esto es lo que
 * el operario ve en la manga mientras tanto, y ahora coincide.
 */
export function stageTreatment(
  d: SyncDevice,
  animalId: string,
  productId: string,
  dose: number | undefined,
  route: string | undefined,
  now: Date,
  newId: NewId,
  timeZone: string,
): { meatUntil: string | null } {
  const product = d.store.getRow('products_veterinary', productId)?.fields;
  const { meatWithdrawalUntil: meatUntil, milkWithdrawalUntil: milkUntil } = computeWithdrawal(
    now,
    (product?.withdrawal_meat_days as number) ?? null,
    (product?.withdrawal_milk_hours as number) ?? null,
    timeZone,
  );
  d.addEvent('treatments', newId(), {
    animal_id: animalId,
    product_id: productId,
    applied_at: now.toISOString(),
    dose: dose ?? null,
    dose_unit: dose ? 'ml' : null,
    route: route ?? null,
    meat_withdrawal_until: meatUntil,
    milk_withdrawal_until: milkUntil,
  });
  d.addEvent('animal_events', newId(), {
    animal_id: animalId,
    event_type: 'treatment',
    payload: { product: (product?.name as string) ?? null, withdrawal_meat_until: meatUntil },
    occurred_at: now.toISOString(),
  });
  return { meatUntil };
}

export function stageHeat(d: SyncDevice, animalId: string, now: Date, newId: NewId): void {
  const at = now.toISOString();
  d.addEvent('breeding_events', newId(), { animal_id: animalId, type: 'heat', occurred_at: at });
  d.addEvent('animal_events', newId(), { animal_id: animalId, event_type: 'heat', payload: {}, occurred_at: at });
}

export function stageService(
  d: SyncDevice,
  animalId: string,
  method: 'ai' | 'natural',
  sireId: string | undefined,
  now: Date,
  newId: NewId,
): void {
  const at = now.toISOString();
  d.addEvent('breeding_events', newId(), {
    animal_id: animalId,
    type: method === 'ai' ? 'service_ai' : 'service_natural',
    occurred_at: at,
    sire_id: sireId ?? null,
  });
  d.addEvent('animal_events', newId(), { animal_id: animalId, event_type: 'service', payload: { method }, occurred_at: at });
}

/**
 * Diagnóstico de preñez. La fecha probable de parto sale del ÚLTIMO servicio registrado en este
 * dispositivo; sin servicio conocido se cae a la estimación conservadora desde el diagnóstico.
 */
export function stageDiagnosis(
  d: SyncDevice,
  animalId: string,
  result: 'pregnant' | 'empty',
  now: Date,
  newId: NewId,
): { expectedDue?: string } {
  const today = farmToday(now);
  const abierta = openPregnancyId(d.store, animalId);

  if (result === 'pregnant') {
    let serviceAt: Date | null = null;
    const be = d.store.events.get('breeding_events');
    if (be) {
      for (const [, row] of be) {
        if (row.animal_id === animalId && String(row.type).startsWith('service')) {
          const at = new Date(String(row.occurred_at));
          if (!serviceAt || at > serviceAt) serviceAt = at;
        }
      }
    }
    const expectedDue = serviceAt ? computeExpectedDueDateFromService(serviceAt) : computeExpectedDueDateFromDiagnosis(now);
    d.setFields('pregnancies', newId(), {
      animal_id: animalId,
      status: 'open',
      diagnosis_date: today,
      method: 'ultrasound',
      expected_due_date: expectedDue,
    });
    d.addEvent('animal_events', newId(), {
      animal_id: animalId,
      event_type: 'pregnancy_diagnosed',
      payload: { method: 'ultrasound', expected_due_date: expectedDue },
      occurred_at: now.toISOString(),
    });
    return { expectedDue };
  }

  if (abierta) d.setFields('pregnancies', abierta, { status: 'lost', closed_at: today });
  d.addEvent('animal_events', newId(), {
    animal_id: animalId,
    event_type: 'pregnancy_negative',
    payload: { previous_lost: !!abierta },
    occurred_at: now.toISOString(),
  });
  return {};
}

export function stageCalving(
  d: SyncDevice,
  damId: string,
  calf: { sex: 'F' | 'M'; tag?: string },
  now: Date,
  newId: NewId,
): { calfId: string } {
  const today = farmToday(now);
  const dam = d.store.getRow('animals', damId)?.fields;
  const pregnancyId = openPregnancyId(d.store, damId);

  const calfId = newId();
  const categoryCode = newbornCategoryCode(calf.sex);
  d.setFields('animals', calfId, {
    visual_tag: calf.tag ?? null,
    name: null,
    status: 'active',
    sex: calf.sex,
    birth_date: today,
    category: categoryCode === 'ternero' ? 'Ternero' : 'Ternera',
    category_code: categoryCode,
    dam_id: damId,
    // Hereda el lote de la madre; el nombre se resuelve del catálogo.
    current_lot_id: (dam?.current_lot_id as string) ?? null,
    last_weight_kg: null,
    last_weighed_at: null,
  });
  if (pregnancyId) d.setFields('pregnancies', pregnancyId, { status: 'calved', closed_at: today });

  const calvingId = newId();
  d.addEvent('calvings', calvingId, { dam_id: damId, pregnancy_id: pregnancyId, calving_date: today, offspring_count: 1 });
  d.addEvent('calving_offspring', newId(), { calving_id: calvingId, animal_id: calfId, vitality: 'live' });
  d.addEvent('animal_events', newId(), {
    animal_id: damId,
    event_type: 'calving',
    payload: { offspring: 1, calf_tag: calf.tag ?? null },
    occurred_at: now.toISOString(),
  });
  d.addEvent('animal_events', newId(), {
    animal_id: calfId,
    event_type: 'birth',
    payload: { dam_tag: (dam?.visual_tag as string) ?? null },
    occurred_at: now.toISOString(),
  });
  return { calfId };
}

/**
 * Alta rápida (corral). Mismo camino que la cría de un parto —un put sobre `animals` con id
 * generado en el teléfono— porque es el único que el servidor ya sabe recibir: el handler
 * contempla explícitamente la «creación de animal offline».
 *
 * `birth_date` va en null a propósito: en un alta rápida nadie sabe la fecha exacta, y poner hoy
 * como nacimiento crearía animales recién nacidos de 400 kilos. Sin fecha el sistema simplemente
 * no calcula edad, que es lo honesto; se completa después desde la web.
 *
 * `origin` viaja de verdad y no queda en el 'born' fijo del INSERT: lo que se da de alta a mano
 * suele ser comprado, y ese campo alimenta la tasa de reposición.
 */
export function stageNewAnimal(
  d: SyncDevice,
  a: {
    tag: string;
    sex: 'F' | 'M';
    categoryCode: string;
    categoryLabel: string;
    origin: 'born' | 'purchased';
    lotId?: string | null;
    /** Opcional: la mayoría de los animales no tiene nombre, pero las vacas de ordeño sí. */
    name?: string | null;
  },
  now: Date,
  newId: NewId,
): { animalId: string } {
  const animalId = newId();
  const nombre = a.name?.trim();
  d.setFields('animals', animalId, {
    visual_tag: a.tag,
    // Vacío se guarda como null, no como cadena vacía: la web muestra la caravana cuando no hay
    // nombre, y una cadena vacía le haría mostrar un hueco.
    name: nombre ? nombre : null,
    status: 'active',
    sex: a.sex,
    birth_date: null,
    category: a.categoryLabel,
    category_code: a.categoryCode,
    origin: a.origin,
    current_lot_id: a.lotId ?? null,
    last_weight_kg: null,
    last_weighed_at: null,
  });
  d.addEvent('animal_events', newId(), {
    animal_id: animalId,
    event_type: 'registered',
    payload: { origin: a.origin, category: a.categoryCode, source: 'movil_alta_rapida' },
    occurred_at: now.toISOString(),
  });
  return { animalId };
}

/**
 * Movimiento offline (P3 M-3.3.a): emite SOLO el event op de intención. El servidor
 * (MovementSyncHandler → recordMovement) deriva el potrero del lote, escribe hecho + timeline y
 * emite el server-origin put que converge el campo en todos los dispositivos. `toLotId=null` ⇒
 * sacar del lote. Sin put compañero (atomicidad de M-3.2.a): el lote local converge al
 * sincronizar (accept-lag).
 */
export function stageMovement(
  d: SyncDevice,
  animalId: string,
  toLotId: string | null,
  reason: string | undefined,
  now: Date,
  newId: NewId,
): void {
  d.addEvent('animal_movements', newId(), {
    animal_id: animalId,
    to_lot_id: toLotId,
    reason: reason ?? 'movimiento',
    moved_at: now.toISOString(),
  });
}

/**
 * Baja por muerte (P5-2, Patrón B): SOLO el event op de `mortalities`. El servidor autora hecho +
 * status='dead' + timeline y converge por server-origin. Sin put de status ni animal_events
 * compañero: la atomicidad de P5-1 exige que el estado y su hecho viajen juntos.
 */
export function stageMortality(d: SyncDevice, animalId: string, notes: string | undefined, now: Date, newId: NewId): void {
  const op = buildMortalityEmit(animalId, notes, now, newId);
  d.addEvent(op.table, op.rowId, op.row);
}

/**
 * Destete (P5-2, Patrón B): SOLO el event op de `weanings`. El servidor materializa atómicamente
 * el hecho, el pesaje asociado (si hay peso, con identidad determinista) y el timeline.
 */
export function stageWeaning(d: SyncDevice, animalId: string, weightKg: number | undefined, now: Date, newId: NewId): void {
  const op = buildWeaningEmit(animalId, weightKg, now, newId);
  d.addEvent(op.table, op.rowId, op.row);
}

/** Nota libre: un único event op sobre `animal_events`. Devuelve `false` si quedó vacía tras trim. */
export function stageNote(d: SyncDevice, animalId: string, text: string, now: Date, newId: NewId): boolean {
  const op = buildNoteEmit(animalId, text, now, newId);
  if (!op) return false;
  d.addEvent(op.table, op.rowId, op.row);
  return true;
}

/**
 * Crear tarea offline (P6-3): put sobre `tasks` (entidad mutable) → optimismo local inmediato +
 * push. El servidor (TaskSyncHandler) sanea (fuerza general/pending); se envían esos valores para
 * dejar el row local completo. `type='health'` y `related_*` son reservados del servidor.
 * Devuelve `false` si el título quedó vacío tras trim.
 */
export function stageTaskCreate(
  d: SyncDevice,
  title: string,
  opts: { dueDate?: string | null; priority?: string } | undefined,
  newId: NewId,
): boolean {
  const t = title.trim();
  if (!t) return false;
  d.setFields('tasks', newId(), {
    title: t,
    type: 'general',
    status: 'pending',
    due_date: opts?.dueDate ?? null,
    priority: opts?.priority ?? 'normal',
    description: null,
    related_type: null,
    related_id: null,
    completed_at: null,
  });
  return true;
}

/**
 * Cambios de estado de una tarea. El TaskSyncHandler acepta estos puts offline y los aplica con
 * la regla única del TaskService; el row local pasa al estado nuevo al instante.
 *
 * `completed_at` lo pone el dispositivo (D2) al completar. Los puts sin `status` —solo `due_date`,
 * solo `assigned_to`— son los que el handler lee como reprogramar y asignar.
 */
export function stageTaskFields(d: SyncDevice, taskId: string, fields: Record<string, unknown>): void {
  d.setFields('tasks', taskId, fields);
}
