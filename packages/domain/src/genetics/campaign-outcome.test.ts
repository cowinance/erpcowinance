import { describe, expect, it } from 'vitest';
import { MIN_SERVICES_FOR_RATE, conceptionBySire, summarizeCampaignOutcome } from './campaign-outcome';

describe('summarizeCampaignOutcome', () => {
  /**
   * La regla que más importa de todo GT-3b: el denominador son las DIAGNOSTICADAS, no las servidas.
   * Dividir por las servidas daría un porcentaje que arranca en cero y sube a medida que se
   * ecografía — y alguien sacaría conclusiones sobre un toro que todavía no tuvo oportunidad de
   * fallar.
   */
  it('la tasa se calcula sobre lo diagnosticado, no sobre lo servido', () => {
    const r = summarizeCampaignOutcome([
      { served: true, diagnosis: 'pregnant' },
      { served: true, diagnosis: 'pregnant' },
      { served: true, diagnosis: 'empty' },
      { served: true, diagnosis: null }, // todavía sin ecografiar
      { served: true, diagnosis: null },
    ]);
    // 2 de 3 diagnosticadas = 66,7 % — no 2 de 5 = 40 %.
    expect(r.conception_rate).toBe(66.7);
    expect(r).toMatchObject({ served: 5, pregnant: 2, empty: 1, pending_diagnosis: 2 });
  });

  // Una dudosa es «todavía no sé», no un fracaso: no puede empujar la tasa hacia abajo.
  it('las dudosas no entran en la tasa y dejan la campaña abierta', () => {
    const r = summarizeCampaignOutcome([
      { served: true, diagnosis: 'pregnant' },
      { served: true, diagnosis: 'doubtful' },
    ]);
    expect(r.conception_rate).toBe(100);
    expect(r.doubtful).toBe(1);
    expect(r.closed).toBe(false);
  });

  it('la campaña cierra recién cuando no queda nada por diagnosticar', () => {
    expect(summarizeCampaignOutcome([{ served: true, diagnosis: 'pregnant' }, { served: true, diagnosis: 'empty' }]).closed).toBe(true);
    expect(summarizeCampaignOutcome([{ served: true, diagnosis: 'pregnant' }, { served: true, diagnosis: null }]).closed).toBe(false);
  });

  it('sin nada diagnosticado la tasa es nula, no cero', () => {
    // Cero significaría «ninguna quedó preñada», que es una afirmación distinta de «todavía no sé».
    const r = summarizeCampaignOutcome([{ served: true, diagnosis: null }]);
    expect(r.conception_rate).toBeNull();
    expect(r.closed).toBe(false);
  });

  it('los no servidos no cuentan en ningún lado', () => {
    const r = summarizeCampaignOutcome([
      { served: false, diagnosis: null },
      { served: true, diagnosis: 'pregnant' },
    ]);
    expect(r.served).toBe(1);
    expect(r.conception_rate).toBe(100);
  });

  it('una campaña vacía no está cerrada', () => {
    expect(summarizeCampaignOutcome([])).toMatchObject({ served: 0, conception_rate: null, closed: false });
  });
});

describe('conceptionBySire', () => {
  const servicios = (toro: string, preñadas: number, vacias: number, pendientes = 0) => [
    ...Array.from({ length: preñadas }, () => ({ sire_key: toro, sire_label: toro, diagnosis: 'pregnant' as const })),
    ...Array.from({ length: vacias }, () => ({ sire_key: toro, sire_label: toro, diagnosis: 'empty' as const })),
    ...Array.from({ length: pendientes }, () => ({ sire_key: toro, sire_label: toro, diagnosis: null })),
  ];

  it('agrupa por toro y calcula su tasa', () => {
    const r = conceptionBySire([...servicios('Sansão', 12, 8), ...servicios('Gyr-2', 8, 12)]);
    expect(r.map((x) => [x.sire_label, x.conception_rate])).toEqual([
      ['Sansão', 60],
      ['Gyr-2', 40],
    ]);
    expect(r[0]).toMatchObject({ services: 20, pregnant: 12, empty: 8, reliable: true });
  });

  /**
   * Con 3 servicios, «33 %» y «67 %» se diferencian en UN animal. Ponerlo arriba de la tabla al
   * lado de un toro con 200 servicios sería una recomendación falsa, y la decisión que sale de ahí
   * —dejar de comprar un semen— es cara.
   */
  it('manda al final lo que no tiene muestra suficiente, por más alta que sea la tasa', () => {
    const r = conceptionBySire([
      ...servicios('Suerte', 2, 0), // 100 %, pero con 2 servicios
      ...servicios('Sansão', 12, 8), // 60 % con 20
    ]);
    expect(r[0].sire_label).toBe('Sansão');
    expect(r[1]).toMatchObject({ sire_label: 'Suerte', conception_rate: 100, reliable: false });
  });

  it('el umbral se mide sobre lo diagnosticado, no sobre los servicios', () => {
    // Muchos servicios pero casi todos sin ecografiar: todavía no se puede comparar.
    const r = conceptionBySire(servicios('Nuevo', 2, 1, 50));
    expect(r[0].services).toBe(53);
    expect(r[0].reliable).toBe(false);
    expect(MIN_SERVICES_FOR_RATE).toBeGreaterThan(3);
  });

  it('un toro sin diagnósticos aparece con tasa nula y no rompe el orden', () => {
    const r = conceptionBySire([...servicios('Sansão', 12, 8), ...servicios('Recién', 0, 0, 5)]);
    expect(r[1]).toMatchObject({ sire_label: 'Recién', conception_rate: null, pending: 5 });
  });

  it('sin servicios devuelve una lista vacía', () => {
    expect(conceptionBySire([])).toEqual([]);
  });
});
