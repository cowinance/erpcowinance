import { describe, it, expect, beforeEach } from 'vitest';
import { SyncDevice } from '@cowinance/sync-core';
import type { Op } from '@cowinance/sync-core';
import { setFarmTimeZone } from '../lib/date';
import {
  stageCalving,
  stageDiagnosis,
  stageMortality,
  stageMovement,
  stageNewAnimal,
  stageNote,
  stageService,
  stageTaskCreate,
  stageTaskFields,
  stageTreatment,
  stageVaccination,
  stageWeaning,
  stageWeighing,
} from './capture-actions';

/** Identificadores predecibles: id-1, id-2, … — así cada emisión se puede afirmar entera. */
function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function dispositivo() {
  const d = new SyncDevice('dev-1');
  d.setFields('animals', 'madre', { status: 'active', visual_tag: '100', current_lot_id: 'lote-a' });
  d.setFields('products_veterinary', 'prod-1', { name: 'Oxitetraciclina', withdrawal_meat_days: 3, withdrawal_milk_hours: 72 });
  d.commit(); // deja el store sembrado y la cola vacía
  return d;
}

/** Las ops que quedaron preparadas por la captura (cierra el changeset para poder verlas). */
const emitido = (d: SyncDevice): Op[] => d.commit()?.ops ?? [];

beforeEach(() => setFarmTimeZone('America/Caracas'));

describe('stageWeighing', () => {
  it('emite el pesaje, el timeline y actualiza el último peso local', () => {
    const d = dispositivo();
    stageWeighing(d, 'madre', 412, 3, new Date('2026-05-01T12:00:00Z'), ids());
    const ops = emitido(d);
    expect(ops.map((o) => `${o.kind}:${o.table}`)).toEqual(['event:weighings', 'event:animal_events', 'put:animals']);
    expect(d.store.getRow('animals', 'madre')?.fields.last_weight_kg).toBe(412);
  });
});

/**
 * El invariante que motivó inyectar la zona: el retiro de carne se cuenta en días de CALENDARIO.
 * Con el mismo instante, la zona del teléfono y UTC caen en días distintos, y calcularlo en UTC
 * daba el retiro corrido hacia ANTES — carne con residuos dada por habilitada.
 */
describe('stageTreatment', () => {
  it('cuenta el retiro en la zona que se le pasa, no en UTC', () => {
    const instante = new Date('2026-03-10T02:00:00Z'); // 9 de marzo, 22:00 en Caracas (-4)
    const enCaracas = stageTreatment(dispositivo(), 'madre', 'prod-1', 10, 'im', instante, ids(), 'America/Caracas');
    const enUtc = stageTreatment(dispositivo(), 'madre', 'prod-1', 10, 'im', instante, ids(), 'UTC');
    expect(enCaracas.meatUntil).toBe('2026-03-12');
    expect(enUtc.meatUntil).toBe('2026-03-13');
  });

  it('guarda el retiro calculado en el propio tratamiento, para leerlo sin señal', () => {
    const d = dispositivo();
    const { meatUntil } = stageTreatment(d, 'madre', 'prod-1', 10, 'im', new Date('2026-03-10T12:00:00Z'), ids(), 'UTC');
    const op = emitido(d).find((o) => o.table === 'treatments');
    expect(op?.kind === 'event' && op.row.meat_withdrawal_until).toBe(meatUntil);
    expect(op?.kind === 'event' && op.row.milk_withdrawal_until).toBe('2026-03-13T12:00:00.000Z');
  });

  it('un producto sin retiro declarado no inventa uno', () => {
    const d = dispositivo();
    d.setFields('products_veterinary', 'sin-retiro', { name: 'Vitamina' });
    d.commit();
    const r = stageTreatment(d, 'madre', 'sin-retiro', undefined, undefined, new Date('2026-03-10T12:00:00Z'), ids(), 'UTC');
    expect(r.meatUntil).toBeNull();
  });
});

describe('stageVaccination', () => {
  it('copia el nombre del producto al timeline para que se lea offline', () => {
    const d = dispositivo();
    stageVaccination(d, 'madre', 'prod-1', 5, 'L-22', new Date('2026-05-01T12:00:00Z'), ids());
    const timeline = emitido(d).find((o) => o.table === 'animal_events');
    expect(timeline?.kind === 'event' && timeline.row.payload).toEqual({ product: 'Oxitetraciclina', dose: 5 });
  });
});

/**
 * Patrón B (event-only): mortalidad y destete emiten UN SOLO op y el servidor autora el resto.
 * Si un refactor agregara un `animal_events` o un put de `status` compañero, el estado y su
 * hecho dejarían de viajar juntos — que es justo lo que P5-1 prohíbe.
 */
describe('Patrón B: una sola operación', () => {
  it('la baja por muerte emite solo mortalities', () => {
    const d = dispositivo();
    stageMortality(d, 'madre', 'rayo', new Date('2026-05-01T12:00:00Z'), ids());
    const ops = emitido(d);
    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe('mortalities');
  });

  it('el destete emite solo weanings', () => {
    const d = dispositivo();
    stageWeaning(d, 'madre', 180, new Date('2026-05-01T12:00:00Z'), ids());
    const ops = emitido(d);
    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe('weanings');
  });

  it('el movimiento emite solo la intención, sin tocar el lote local', () => {
    const d = dispositivo();
    stageMovement(d, 'madre', 'lote-b', 'aparte', new Date('2026-05-01T12:00:00Z'), ids());
    const ops = emitido(d);
    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe('animal_movements');
    // El campo converge al sincronizar (accept-lag), no se adelanta acá.
    expect(d.store.getRow('animals', 'madre')?.fields.current_lot_id).toBe('lote-a');
  });

  it('un movimiento sin motivo declara uno genérico en vez de null', () => {
    const d = dispositivo();
    stageMovement(d, 'madre', null, undefined, new Date('2026-05-01T12:00:00Z'), ids());
    const op = emitido(d)[0];
    expect(op.kind === 'event' && op.row).toMatchObject({ to_lot_id: null, reason: 'movimiento' });
  });
});

/** Lo que NO se emite importa tanto como lo que sí: una captura vacía no debe ensuciar la cola. */
describe('capturas que no emiten nada', () => {
  it('una nota en blanco no deja operación ni changeset', () => {
    const d = dispositivo();
    expect(stageNote(d, 'madre', '   ', new Date(), ids())).toBe(false);
    expect(d.commit()).toBeNull();
  });

  it('una nota con texto sí se emite', () => {
    const d = dispositivo();
    expect(stageNote(d, 'madre', ' se cayó en el barro ', new Date(), ids())).toBe(true);
    const op = emitido(d)[0];
    expect(op.table).toBe('animal_events');
    expect(op.kind === 'event' && op.row.event_type).toBe('note');
  });

  it('una tarea sin título no se crea', () => {
    const d = dispositivo();
    expect(stageTaskCreate(d, '  ', undefined, ids())).toBe(false);
    expect(d.commit()).toBeNull();
  });

  it('una tarea nueva viaja saneada como la espera el servidor', () => {
    const d = dispositivo();
    expect(stageTaskCreate(d, '  Revisar aguada  ', { dueDate: '2026-06-01', priority: 'high' }, ids())).toBe(true);
    const op = emitido(d)[0];
    expect(op.kind === 'put' && op.fields).toMatchObject({
      title: 'Revisar aguada',
      type: 'general',
      status: 'pending',
      due_date: '2026-06-01',
      priority: 'high',
    });
  });

  it('stageTaskFields manda exactamente los campos que se le dan', () => {
    const d = dispositivo();
    stageTaskFields(d, 't-1', { due_date: '2026-07-01' });
    const op = emitido(d)[0];
    expect(op.kind === 'put' && op.fields).toEqual({ due_date: '2026-07-01' });
  });
});

describe('stageDiagnosis', () => {
  it('una preñez positiva fecha el parto desde el último servicio del dispositivo', () => {
    const d = dispositivo();
    stageService(d, 'madre', 'ai', 'toro-1', new Date('2026-01-10T12:00:00Z'), ids());
    stageService(d, 'madre', 'natural', undefined, new Date('2026-02-20T12:00:00Z'), ids());
    d.commit();
    const { expectedDue } = stageDiagnosis(d, 'madre', 'pregnant', new Date('2026-04-01T12:00:00Z'), ids());
    const desdeDiagnostico = stageDiagnosis(dispositivo(), 'madre', 'pregnant', new Date('2026-04-01T12:00:00Z'), ids());
    // Hay servicio: la fecha sale de él, no de la estimación desde el diagnóstico.
    expect(expectedDue).toBeDefined();
    expect(expectedDue).not.toBe(desdeDiagnostico.expectedDue);
  });

  it('sin servicio conocido cae a la estimación desde el diagnóstico', () => {
    const { expectedDue } = stageDiagnosis(dispositivo(), 'madre', 'pregnant', new Date('2026-04-01T12:00:00Z'), ids());
    expect(expectedDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('un diagnóstico negativo cierra como perdida la preñez abierta', () => {
    const d = dispositivo();
    d.setFields('pregnancies', 'p-1', { animal_id: 'madre', status: 'open' });
    d.commit();
    stageDiagnosis(d, 'madre', 'empty', new Date('2026-04-01T12:00:00Z'), ids());
    const ops = emitido(d);
    const cierre = ops.find((o) => o.table === 'pregnancies');
    expect(cierre?.kind === 'put' && cierre.rowId).toBe('p-1');
    expect(cierre?.kind === 'put' && cierre.fields.status).toBe('lost');
    const timeline = ops.find((o) => o.table === 'animal_events');
    expect(timeline?.kind === 'event' && timeline.row.payload).toEqual({ previous_lost: true });
  });

  it('un negativo sin preñez abierta solo deja el registro, sin cerrar nada', () => {
    const d = dispositivo();
    stageDiagnosis(d, 'madre', 'empty', new Date('2026-04-01T12:00:00Z'), ids());
    const ops = emitido(d);
    expect(ops.map((o) => o.table)).toEqual(['animal_events']);
    expect(ops[0].kind === 'event' && ops[0].row.payload).toEqual({ previous_lost: false });
  });
});

describe('stageCalving', () => {
  it('la cría hereda el lote de la madre y cierra la preñez abierta', () => {
    const d = dispositivo();
    d.setFields('pregnancies', 'p-1', { animal_id: 'madre', status: 'open' });
    d.commit();
    const { calfId } = stageCalving(d, 'madre', { sex: 'F', tag: '101' }, new Date('2026-04-01T12:00:00Z'), ids());
    const ops = emitido(d);
    const cria = ops.find((o) => o.kind === 'put' && o.table === 'animals' && o.rowId === calfId);
    expect(cria?.kind === 'put' && cria.fields).toMatchObject({
      visual_tag: '101',
      sex: 'F',
      category_code: 'ternera',
      dam_id: 'madre',
      current_lot_id: 'lote-a',
    });
    const prenez = ops.find((o) => o.table === 'pregnancies');
    expect(prenez?.kind === 'put' && prenez.fields.status).toBe('calved');
  });

  it('escribe el timeline de la madre y el del recién nacido', () => {
    const d = dispositivo();
    const { calfId } = stageCalving(d, 'madre', { sex: 'M' }, new Date('2026-04-01T12:00:00Z'), ids());
    const timeline = emitido(d).filter((o) => o.table === 'animal_events');
    expect(timeline).toHaveLength(2);
    const porAnimal = Object.fromEntries(
      timeline.map((o) => [o.kind === 'event' ? o.row.animal_id : '', o.kind === 'event' ? o.row.event_type : '']),
    );
    expect(porAnimal).toEqual({ madre: 'calving', [calfId]: 'birth' });
  });

  it('un parto sin preñez registrada igual se guarda, con la preñez en null', () => {
    const d = dispositivo();
    stageCalving(d, 'madre', { sex: 'F' }, new Date('2026-04-01T12:00:00Z'), ids());
    const parto = emitido(d).find((o) => o.table === 'calvings');
    expect(parto?.kind === 'event' && parto.row.pregnancy_id).toBeNull();
  });
});

describe('stageNewAnimal', () => {
  /**
   * `birth_date` en null es deliberado: en un alta rápida nadie sabe la fecha, y poner hoy
   * crearía animales recién nacidos de 400 kilos.
   */
  it('no inventa fecha de nacimiento y conserva el origen declarado', () => {
    const d = dispositivo();
    stageNewAnimal(
      d,
      { tag: '555', sex: 'M', categoryCode: 'novillo', categoryLabel: 'Novillo', origin: 'purchased', lotId: 'lote-b' },
      new Date('2026-04-01T12:00:00Z'),
      ids(),
    );
    const alta = emitido(d).find((o) => o.kind === 'put' && o.table === 'animals');
    expect(alta?.kind === 'put' && alta.fields).toMatchObject({
      visual_tag: '555',
      birth_date: null,
      origin: 'purchased',
      category_code: 'novillo',
      current_lot_id: 'lote-b',
    });
  });
});
