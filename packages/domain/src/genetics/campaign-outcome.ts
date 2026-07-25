/**
 * Resultado de una campaña de servicio (GT-3b).
 *
 * La IATF no termina cuando se insemina: termina a los ~28 días, cuando se sabe si quedaron
 * preñadas. Sin ese cierre nunca se averigua si la campaña funcionó — y sobre todo, nunca se
 * averigua **qué toro funcionó**, que es el número que decide qué semen se vuelve a comprar.
 *
 * Con esto el lazo se cierra: pajuela → vaca → preñez → tasa de concepción por toro → decisión de
 * compra. El termo deja de ser un depósito y pasa a ser donde se mide si la genética sirve.
 */

export const DIAGNOSIS_RESULTS = ['pregnant', 'empty', 'doubtful'] as const;
export type DiagnosisResult = (typeof DIAGNOSIS_RESULTS)[number];

export interface CampaignOutcome {
  served: number;
  pregnant: number;
  empty: number;
  doubtful: number;
  /** Servidas que todavía no se ecografiaron: la campaña sigue abierta mientras haya alguna. */
  pending_diagnosis: number;
  /** `pregnant / (pregnant + empty)`, en porcentaje. `null` mientras no haya nada diagnosticado. */
  conception_rate: number | null;
  closed: boolean;
}

/**
 * El denominador son las DIAGNOSTICADAS, no las servidas.
 *
 * Dividir por las servidas daría un porcentaje que arranca en cero y sube a medida que se
 * ecografía: durante los primeros días la campaña parecería un desastre, y alguien miraría ese
 * número y sacaría conclusiones sobre un toro que todavía no tuvo oportunidad de fallar. Las
 * dudosas también quedan afuera: son un «todavía no sé», no un fracaso.
 */
export function summarizeCampaignOutcome(
  rows: readonly { served: boolean; diagnosis: DiagnosisResult | null }[],
): CampaignOutcome {
  const servidas = rows.filter((r) => r.served);
  const pregnant = servidas.filter((r) => r.diagnosis === 'pregnant').length;
  const empty = servidas.filter((r) => r.diagnosis === 'empty').length;
  const doubtful = servidas.filter((r) => r.diagnosis === 'doubtful').length;
  const pendientes = servidas.filter((r) => r.diagnosis === null).length;
  const diagnosticadas = pregnant + empty;

  return {
    served: servidas.length,
    pregnant,
    empty,
    doubtful,
    pending_diagnosis: pendientes,
    conception_rate: diagnosticadas === 0 ? null : Math.round((pregnant / diagnosticadas) * 1000) / 10,
    // Una dudosa deja la campaña abierta igual que una sin diagnosticar: falta el recontrol.
    closed: servidas.length > 0 && pendientes === 0 && doubtful === 0,
  };
}

/**
 * Cuántos servicios hacen falta para que una tasa signifique algo.
 *
 * Con 3 servicios, «33 %» y «67 %» se diferencian en UN animal. Publicar ese número al lado del de
 * un toro con 200 servicios invita a comparar cosas que no son comparables, y la decisión que sale
 * de ahí —dejar de comprar un semen— es cara. El umbral no oculta el dato: lo marca.
 */
export const MIN_SERVICES_FOR_RATE = 15;

export interface SireConception {
  sire_key: string;
  sire_label: string;
  services: number;
  pregnant: number;
  empty: number;
  pending: number;
  conception_rate: number | null;
  /** ¿Hay suficientes servicios como para comparar esta tasa con otra? */
  reliable: boolean;
}

/**
 * Tasa de concepción por toro. Ordena por tasa, pero deja al final lo que todavía no se puede
 * comparar: un toro con dos servicios arriba de la tabla sería una recomendación falsa.
 */
export function conceptionBySire(
  rows: readonly { sire_key: string; sire_label: string; diagnosis: DiagnosisResult | null }[],
): SireConception[] {
  const porToro = new Map<string, { label: string; pregnant: number; empty: number; pending: number; services: number }>();
  for (const r of rows) {
    const acc = porToro.get(r.sire_key) ?? { label: r.sire_label, pregnant: 0, empty: 0, pending: 0, services: 0 };
    acc.services++;
    if (r.diagnosis === 'pregnant') acc.pregnant++;
    else if (r.diagnosis === 'empty') acc.empty++;
    else acc.pending++;
    porToro.set(r.sire_key, acc);
  }

  return [...porToro.entries()]
    .map(([sire_key, a]) => {
      const diagnosticadas = a.pregnant + a.empty;
      return {
        sire_key,
        sire_label: a.label,
        services: a.services,
        pregnant: a.pregnant,
        empty: a.empty,
        pending: a.pending,
        conception_rate: diagnosticadas === 0 ? null : Math.round((a.pregnant / diagnosticadas) * 1000) / 10,
        reliable: diagnosticadas >= MIN_SERVICES_FOR_RATE,
      };
    })
    .sort((a, b) => {
      if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
      return (b.conception_rate ?? -1) - (a.conception_rate ?? -1) || b.services - a.services;
    });
}
