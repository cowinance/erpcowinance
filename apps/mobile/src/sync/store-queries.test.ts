import { describe, it, expect } from 'vitest';
import { MemStore } from '@cowinance/sync-core';
import type { Changeset, Op } from '@cowinance/sync-core';
import {
  describePending,
  effectiveWithdrawal,
  findAnimalByTag,
  findOpenPregnancy,
  getAnimal,
  listAnimalEvents,
  listAnimals,
  listBulls,
  listCategoriesInUse,
  listLots,
  listProducts,
  listTasks,
  tieneCapacidad,
} from './store-queries';

/** Store armado a mano: lo mismo que deja el bootstrap, sin red ni persistencia. */
function store(seed: {
  animals?: Record<string, Record<string, unknown>>;
  lots?: Record<string, Record<string, unknown>>;
  tasks?: Record<string, Record<string, unknown>>;
  products?: Record<string, Record<string, unknown>>;
  pregnancies?: Record<string, Record<string, unknown>>;
  treatments?: Record<string, Record<string, unknown>>;
  animalEvents?: Record<string, Record<string, unknown>>;
}) {
  const s = new MemStore();
  const rows = (tabla: string, data?: Record<string, Record<string, unknown>>) => {
    for (const [id, fields] of Object.entries(data ?? {})) s.putRow(tabla, id, { fields, versions: {} });
  };
  rows('animals', seed.animals);
  rows('lots', seed.lots);
  rows('tasks', seed.tasks);
  rows('products_veterinary', seed.products);
  rows('pregnancies', seed.pregnancies);
  for (const [id, row] of Object.entries(seed.treatments ?? {})) s.addEvent('treatments', id, row);
  for (const [id, row] of Object.entries(seed.animalEvents ?? {})) s.addEvent('animal_events', id, row);
  return s;
}

const activo = (extra: Record<string, unknown> = {}) => ({ status: 'active', ...extra });

describe('listAnimals', () => {
  it('deja fuera lo que no está activo', () => {
    const s = store({ animals: { a: activo({ visual_tag: '1' }), b: { status: 'dead', visual_tag: '2' } } });
    expect(listAnimals(s).map((a) => a.tag)).toEqual(['1']);
  });

  it('ordena las caravanas como números, no como texto', () => {
    const s = store({
      animals: { a: activo({ visual_tag: '10' }), b: activo({ visual_tag: '9' }), c: activo({ visual_tag: '100' }) },
    });
    expect(listAnimals(s).map((a) => a.tag)).toEqual(['9', '10', '100']);
  });

  it('busca por caravana y por nombre, sin distinguir mayúsculas', () => {
    const s = store({ animals: { a: activo({ visual_tag: '77', name: 'Lucera' }), b: activo({ visual_tag: '88' }) } });
    expect(listAnimals(s, 'luc').map((a) => a.tag)).toEqual(['77']);
    expect(listAnimals(s, '88').map((a) => a.tag)).toEqual(['88']);
    expect(listAnimals(s, 'zzz')).toEqual([]);
  });

  /**
   * El invariante que justifica resolver el lote contra el catálogo en cada lectura: tras un
   * movimiento offline el put actualiza `current_lot_id` pero NO el `lot_name` denormalizado.
   * Si se leyera el campo guardado, la manga mostraría el lote anterior.
   */
  it('resuelve el nombre del lote del catálogo y no del campo viejo de la fila', () => {
    const s = store({
      animals: { a: activo({ visual_tag: '5', current_lot_id: 'l2', lot_name: 'Rodeo viejo' }) },
      lots: { l1: { name: 'Rodeo viejo' }, l2: { name: 'Rodeo nuevo' } },
    });
    expect(listAnimals(s)[0].lot_name).toBe('Rodeo nuevo');
  });

  it('deja el lote sin nombre si el animal no está en ninguno', () => {
    const s = store({ animals: { a: activo({ visual_tag: '5', current_lot_id: null }) }, lots: { l1: { name: 'X' } } });
    expect(listAnimals(s)[0].lot_name).toBeUndefined();
  });
});

describe('findAnimalByTag', () => {
  it('ignora espacios alrededor de lo tecleado en la manga', () => {
    const s = store({ animals: { a: activo({ visual_tag: '123' }) } });
    expect(findAnimalByTag(s, '  123 ')?.id).toBe('a');
  });

  it('no devuelve un animal dado de baja aunque la caravana coincida', () => {
    const s = store({ animals: { a: { status: 'dead', visual_tag: '123' } } });
    expect(findAnimalByTag(s, '123')).toBeNull();
  });
});

/**
 * Lo más delicado del módulo: si el retiro sale corto, se habilita carne con residuos.
 * El servidor es la autoridad, pero lo que este teléfono capturó sin señal todavía no llegó
 * allá — y es justamente lo más reciente.
 */
describe('effectiveWithdrawal', () => {
  it('un tratamiento capturado offline extiende el retiro que trajo el servidor', () => {
    const s = store({
      animals: { a: activo({ meat_withdrawal_until: '2026-03-01', milk_withdrawal_until: null }) },
      treatments: { t1: { animal_id: 'a', meat_withdrawal_until: '2026-03-20', milk_withdrawal_until: '2026-03-05' } },
    });
    expect(effectiveWithdrawal(s, 'a')).toEqual({ meat: '2026-03-20', milk: '2026-03-05' });
  });

  it('si el del servidor es el más lejano, gana el del servidor', () => {
    const s = store({
      animals: { a: activo({ meat_withdrawal_until: '2026-04-30' }) },
      treatments: { t1: { animal_id: 'a', meat_withdrawal_until: '2026-03-20' } },
    });
    expect(effectiveWithdrawal(s, 'a').meat).toBe('2026-04-30');
  });

  it('el tratamiento de otro animal no contamina el retiro', () => {
    const s = store({
      animals: { a: activo({ meat_withdrawal_until: null }), b: activo({}) },
      treatments: { t1: { animal_id: 'b', meat_withdrawal_until: '2026-12-31' } },
    });
    expect(effectiveWithdrawal(s, 'a').meat).toBeNull();
  });

  it('sin retiros devuelve null, no una fecha inventada', () => {
    const s = store({ animals: { a: activo({}) } });
    expect(effectiveWithdrawal(s, 'a')).toEqual({ meat: null, milk: null });
  });
});

describe('tieneCapacidad', () => {
  it('sin matriz conocida ofrece de más: el servidor rechazará si corresponde', () => {
    expect(tieneCapacidad(undefined, 'lo_que_sea')).toBe(true);
  });

  it('una capacidad ausente de la matriz está denegada', () => {
    expect(tieneCapacidad({ herd: 'write' }, 'finanzas')).toBe(false);
  });

  it('un permiso de solo lectura deja leer pero no guardar', () => {
    expect(tieneCapacidad({ herd: 'read' }, 'herd', 'read')).toBe(true);
    expect(tieneCapacidad({ herd: 'read' }, 'herd', 'write')).toBe(false);
  });

  it('un permiso de escritura habilita ambos', () => {
    expect(tieneCapacidad({ herd: 'write' }, 'herd', 'read')).toBe(true);
    expect(tieneCapacidad({ herd: 'write' }, 'herd', 'write')).toBe(true);
  });

  it('por defecto pregunta por escritura, que es lo que esconde un botón', () => {
    expect(tieneCapacidad({ herd: 'read' }, 'herd')).toBe(false);
  });
});

/** Helpers mínimos para armar una cola: lo que importa es `ops`, no la identidad del changeset. */
const evento = (table: string, row: Record<string, unknown>): Op => ({ kind: 'event', table, rowId: 'e', row, hlc: '0' });
const put = (table: string, rowId: string, fields: Record<string, unknown>): Op => ({ kind: 'put', table, rowId, fields, hlc: '0' });
const cola = (seq: number, ops: Op[]): Changeset => ({ id: `c${seq}`, deviceId: 'd', seq, hlc: '0', schemaVersion: 1, ops });

/**
 * Esta es la pantalla que mira alguien que capturó sin señal y necesita ver que su trabajo
 * sigue ahí. Que una captura no aparezca se lee como trabajo perdido.
 */
describe('describePending', () => {
  it('nombra cada captura y le pone la caravana del animal', () => {
    const s = store({ animals: { a: activo({ visual_tag: '42' }) } });
    const items = describePending([cola(1, [evento('weighings', { animal_id: 'a', weight_kg: 380 })])], s);
    expect(items).toEqual([{ seq: 1, summary: 'Pesaje · 380 kg', tag: '42' }]);
  });

  it('no repite el espejo del timeline, pero sí muestra la nota', () => {
    const s = store({ animals: { a: activo({ visual_tag: '7' }) } });
    const items = describePending(
      [
        cola(1, [
          evento('treatments', { animal_id: 'a' }),
          evento('animal_events', { animal_id: 'a', event_type: 'treatment' }),
          evento('animal_events', { animal_id: 'a', event_type: 'note' }),
        ]),
      ],
      s,
    );
    expect(items.map((i) => i.summary)).toEqual(['Tratamiento', 'Nota']);
  });

  it('omite el detalle interno del parto y conserva el parto', () => {
    const s = store({ animals: { madre: activo({ visual_tag: '3' }) } });
    const items = describePending(
      [cola(2, [evento('calvings', { dam_id: 'madre' }), evento('calving_offspring', { calving_id: 'x' })])],
      s,
    );
    expect(items.map((i) => i.summary)).toEqual(['Parto']);
    expect(items[0].tag).toBe('3');
  });

  it('distingue un alta de animal de una edición', () => {
    const s = store({ animals: { a: activo({ visual_tag: '9' }) } });
    const alta = describePending([cola(1, [put('animals', 'nuevo', { visual_tag: '55' })])], s);
    const edicion = describePending([cola(2, [put('animals', 'a', { last_weight_kg: 300 })])], s);
    expect(alta[0]).toEqual({ seq: 1, summary: 'Alta de animal', tag: '55' });
    expect(edicion[0]).toEqual({ seq: 2, summary: 'Cambios del animal', tag: '9' });
  });

  it('separa celo, servicio y el resto de los eventos reproductivos', () => {
    const s = store({ animals: { a: activo({ visual_tag: '1' }) } });
    const items = describePending(
      [
        cola(1, [
          evento('breeding_events', { animal_id: 'a', type: 'heat' }),
          evento('breeding_events', { animal_id: 'a', type: 'service_ai' }),
          evento('breeding_events', { animal_id: 'a', type: 'otro' }),
        ]),
      ],
      s,
    );
    expect(items.map((i) => i.summary)).toEqual(['Celo', 'Servicio', 'Evento reproductivo']);
  });

  it('nombra los tres estados de una preñez', () => {
    const s = store({ animals: { a: activo({ visual_tag: '1' }) } });
    const resumen = (status: string) =>
      describePending([cola(1, [put('pregnancies', 'p', { animal_id: 'a', status })])], s)[0].summary;
    expect(resumen('open')).toBe('Diagnóstico de preñez');
    expect(resumen('calved')).toBe('Cierre de preñez (parto)');
    expect(resumen('lost')).toBe('Cambio de preñez');
  });

  it('una captura de un animal que el store no conoce igual aparece, sin caravana', () => {
    const items = describePending([cola(1, [evento('weighings', { animal_id: 'fantasma', weight_kg: 1 })])], store({}));
    expect(items).toEqual([{ seq: 1, summary: 'Pesaje · 1 kg', tag: undefined }]);
  });
});

describe('catálogos', () => {
  it('listLots ordena por nombre y completa los campos que faltan', () => {
    const s = store({ lots: { b: { name: 'Zorzal' }, a: { name: 'Álamo', current_paddock_id: 'p1', paddock_name: 'Norte' } } });
    expect(listLots(s)).toEqual([
      { id: 'a', name: 'Álamo', current_paddock_id: 'p1', paddock_name: 'Norte' },
      { id: 'b', name: 'Zorzal', current_paddock_id: null, paddock_name: null },
    ]);
  });

  it('listTasks pone los valores por defecto del servidor cuando la fila viene corta', () => {
    const s = store({ tasks: { t: { title: 'Vacunar' } } });
    expect(listTasks(s)[0]).toEqual({
      id: 't',
      title: 'Vacunar',
      description: null,
      type: 'general',
      status: 'pending',
      due_date: null,
      priority: 'normal',
      related_type: null,
      related_id: null,
      assigned_to: null,
    });
  });

  it('listProducts separa vacunas del resto', () => {
    const s = store({
      products: { p1: { name: 'Aftosa', type: 'vaccine' }, p2: { name: 'Ivermectina', type: 'antiparasitic' } },
    });
    expect(listProducts(s, 'vaccine').map((p) => p.name)).toEqual(['Aftosa']);
    expect(listProducts(s, 'other').map((p) => p.name)).toEqual(['Ivermectina']);
    expect(listProducts(s).map((p) => p.name)).toEqual(['Aftosa', 'Ivermectina']);
  });

  it('listBulls toma solo toros activos', () => {
    const s = store({
      animals: {
        t1: activo({ category_code: 'toro', visual_tag: 'T1' }),
        t2: { status: 'dead', category_code: 'toro' },
        v1: activo({ category_code: 'vaca' }),
      },
    });
    expect(listBulls(s).map((a) => a.tag)).toEqual(['T1']);
  });

  it('las categorías salen del rodeo bajado, sin repetir y ordenadas', () => {
    const s = store({
      animals: {
        a: activo({ category_code: 'vaca', category: 'Vaca' }),
        b: activo({ category_code: 'vaca', category: 'Vaca' }),
        c: activo({ category_code: 'ternero', category: 'Ternero' }),
      },
    });
    expect(listCategoriesInUse(s)).toEqual([
      { code: 'ternero', label: 'Ternero' },
      { code: 'vaca', label: 'Vaca' },
    ]);
  });

  it('una categoría sin etiqueta cae al código antes que mostrar un hueco', () => {
    const s = store({ animals: { a: activo({ category_code: 'novillo' }) } });
    expect(listCategoriesInUse(s)).toEqual([{ code: 'novillo', label: 'novillo' }]);
  });
});

describe('timeline y preñez', () => {
  it('listAnimalEvents trae solo los del animal, del más nuevo al más viejo', () => {
    const s = store({
      animalEvents: {
        e1: { animal_id: 'a', event_type: 'weighing', occurred_at: '2026-01-01T00:00:00Z', payload: { kg: 1 } },
        e2: { animal_id: 'a', event_type: 'note', occurred_at: '2026-02-01T00:00:00Z' },
        e3: { animal_id: 'otro', event_type: 'note', occurred_at: '2026-03-01T00:00:00Z' },
      },
    });
    const eventos = listAnimalEvents(s, 'a');
    expect(eventos.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(eventos[1].data).toEqual({ kg: 1 });
    expect(eventos[0].data).toEqual({});
  });

  it('findOpenPregnancy ignora las preñeces cerradas', () => {
    const s = store({
      pregnancies: { p1: { animal_id: 'a', status: 'calved' }, p2: { animal_id: 'a', status: 'open' } },
    });
    expect(findOpenPregnancy(s, 'a')?.id).toBe('p2');
    expect(findOpenPregnancy(s, 'b')).toBeNull();
  });
});

/**
 * Arranque en frío sin señal: el provider todavía no hidrató el store. Nada de esto puede
 * explotar — una pantalla en blanco en el potrero no tiene vuelta atrás.
 */
describe('sin store todavía', () => {
  it('toda lectura devuelve vacío en vez de romper', () => {
    expect(listAnimals(undefined)).toEqual([]);
    expect(getAnimal(undefined, 'a')).toBeNull();
    expect(findAnimalByTag(undefined, '1')).toBeNull();
    expect(listAnimalEvents(undefined, 'a')).toEqual([]);
    expect(listProducts(undefined)).toEqual([]);
    expect(listBulls(undefined)).toEqual([]);
    expect(listLots(undefined)).toEqual([]);
    expect(listTasks(undefined)).toEqual([]);
    expect(listCategoriesInUse(undefined)).toEqual([]);
    expect(findOpenPregnancy(undefined, 'a')).toBeNull();
    expect(effectiveWithdrawal(undefined, 'a')).toEqual({ meat: null, milk: null });
    expect(describePending([], undefined)).toEqual([]);
  });
});
