import { describe, expect, it } from 'vitest';
import {
  InvalidServicePlanError,
  buildPickingList,
  shouldReleaseReservation,
  summarizeCampaign,
  validatePlanEntry,
} from './service-plan';

describe('validatePlanEntry', () => {
  it('acepta una inseminación con su partida y una transferencia con su embrión', () => {
    expect(validatePlanEntry({ animal_id: 'a1', method: 'ai', semen_batch_id: 'b1', straw_id: 's1' })).toEqual({
      animal_id: 'a1',
      method: 'ai',
      semen_batch_id: 'b1',
      embryo_id: null,
      straw_id: 's1',
    });
    expect(validatePlanEntry({ animal_id: 'a2', method: 'embryo_transfer', embryo_id: 'e1' })).toMatchObject({
      method: 'embryo_transfer',
      embryo_id: 'e1',
      semen_batch_id: null,
    });
  });

  /**
   * Un plan con el método y el origen cruzados no se puede ejecutar, y eso se descubriría recién
   * con la vaca en la manga.
   */
  it('rechaza el método cruzado con el origen', () => {
    expect(() => validatePlanEntry({ animal_id: 'a1', method: 'ai', embryo_id: 'e1' })).toThrow(/partida de semen/);
    expect(() => validatePlanEntry({ animal_id: 'a1', method: 'embryo_transfer', semen_batch_id: 'b1' })).toThrow(/embrión/);
    // Y tampoco los dos a la vez.
    expect(() => validatePlanEntry({ animal_id: 'a1', method: 'ai', semen_batch_id: 'b1', embryo_id: 'e1' })).toThrow(
      InvalidServicePlanError,
    );
  });

  it('exige animal y método válido', () => {
    expect(() => validatePlanEntry({ method: 'ai', semen_batch_id: 'b1' })).toThrow(/animal_id/);
    expect(() => validatePlanEntry({ animal_id: 'a1', method: 'monta' })).toThrow(/method/);
  });

  // La pajuela puede faltar todavía: se planifica el toro primero y se reserva la unidad después.
  it('la pajuela concreta es opcional', () => {
    expect(validatePlanEntry({ animal_id: 'a1', method: 'ai', semen_batch_id: 'b1' }).straw_id).toBeNull();
  });
});

describe('shouldReleaseReservation', () => {
  /**
   * Sin liberación automática, cada campaña deja reservas de animales que nunca se sirvieron, y en
   * tres campañas el «libre» del termo no significa nada.
   */
  it('libera cuando el vientre queda fuera de la jornada', () => {
    expect(shouldReleaseReservation('not_eligible', 'planned')).toBe(true);
  });

  it('no libera si todavía no se revisó, o si salió apta', () => {
    expect(shouldReleaseReservation('pending', 'planned')).toBe(false);
    expect(shouldReleaseReservation('eligible', 'planned')).toBe(false);
  });

  // Una entrada ya servida consumió su pajuela: no hay nada que soltar.
  it('no libera lo ya servido', () => {
    expect(shouldReleaseReservation('not_eligible', 'served')).toBe(false);
  });
});

describe('buildPickingList', () => {
  const fila = (o: Partial<Parameters<typeof buildPickingList>[0][number]>) => ({
    straw_id: 's',
    animal_tag: null,
    origin_label: 'x',
    tank_code: null,
    canister_code: null,
    canister_color: null,
    goblet_code: null,
    ...o,
  });

  /**
   * Se agrupa por posición y no por animal porque cada apertura del termo evapora nitrógeno:
   * conviene abrir una vez por gobelete y llevarse todo junto.
   */
  it('agrupa por posición, no por animal', () => {
    const lista = buildPickingList([
      fila({ straw_id: 's1', animal_tag: '001', tank_code: '207', canister_code: '2', goblet_code: '5' }),
      fila({ straw_id: 's2', animal_tag: '002', tank_code: '207', canister_code: '2', goblet_code: '5' }),
      fila({ straw_id: 's3', animal_tag: '003', tank_code: '207', canister_code: '1', goblet_code: '1' }),
    ]);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ canister_code: '1', goblet_code: '1' });
    expect(lista[1].straws.map((s) => s.animal_tag)).toEqual(['001', '002']);
  });

  it('ordena por el recorrido del termo: termo, canasta, gobelete', () => {
    const lista = buildPickingList([
      fila({ straw_id: 'b', tank_code: '207', canister_code: '2', goblet_code: '1' }),
      fila({ straw_id: 'a', tank_code: '003', canister_code: '9', goblet_code: '9' }),
      fila({ straw_id: 'c', tank_code: '207', canister_code: '1', goblet_code: '4' }),
    ]);
    expect(lista.map((l) => `${l.tank_code}/${l.canister_code}/${l.goblet_code}`)).toEqual(['003/9/9', '207/1/4', '207/2/1']);
  });

  // Lo que no tiene posición no se puede ir a buscar: va al final, no mezclado en el recorrido.
  it('manda al final lo que no tiene ubicación', () => {
    const lista = buildPickingList([
      fila({ straw_id: 'sinpos' }),
      fila({ straw_id: 'conpos', tank_code: '207', canister_code: '1', goblet_code: '1' }),
    ]);
    expect(lista[0].goblet_code).toBe('1');
    expect(lista[1].goblet_code).toBeNull();
  });

  it('una lista vacía no rompe', () => {
    expect(buildPickingList([])).toEqual([]);
  });
});

describe('summarizeCampaign', () => {
  /**
   * `without_straw` es el único número accionable ANTES de la jornada: una entrada planificada sin
   * pajuela reservada es una vaca que va a llegar a la manga sin nada con qué servirla.
   */
  it('separa lo planificado sin pajuela reservada', () => {
    expect(
      summarizeCampaign([
        { eligibility: 'eligible', status: 'planned', straw_id: 's1' },
        { eligibility: 'eligible', status: 'planned', straw_id: null },
        { eligibility: 'not_eligible', status: 'released', straw_id: null },
        { eligibility: 'pending', status: null, straw_id: null },
        { eligibility: 'eligible', status: 'served', straw_id: 's2' },
      ]),
    ).toEqual({
      total: 5,
      pending_review: 1,
      eligible: 3,
      not_eligible: 1,
      planned: 2,
      served: 1,
      without_straw: 1,
    });
  });

  it('una campaña recién armada está toda pendiente de revisión', () => {
    const filas = Array.from({ length: 30 }, () => ({ eligibility: 'pending' as const, status: null, straw_id: null }));
    expect(summarizeCampaign(filas)).toMatchObject({ total: 30, pending_review: 30, served: 0 });
  });
});
