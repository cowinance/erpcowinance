/**
 * Pipeline comercial (F3). Reglas puras: qué etapas existe, cómo se avanza y cuánto vale lo que
 * está en curso.
 */

export const OPPORTUNITY_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/**
 * Probabilidad de cierre por etapa. Es lo que convierte una lista de intenciones en un número
 * comparable: sin ponderar, diez charlas iniciales "valen" lo mismo que diez contratos a punto de
 * firmarse, y el pipeline deja de servir para decidir.
 *
 * Los valores son la convención comercial habitual (10/25/50/75). No pretenden ser una predicción:
 * son un peso, y por eso el resumen informa SIEMPRE el total sin ponderar al lado del ponderado.
 */
export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  lead: 0.1,
  qualified: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  won: 1,
  lost: 0,
};

export const TERMINAL_STAGES: OpportunityStage[] = ['won', 'lost'];

export function isTerminal(stage: OpportunityStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export class InvalidStageTransitionError extends Error {
  readonly code = 'crm.invalid_stage';
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InvalidStageTransitionError';
  }
}

/**
 * Transiciones permitidas.
 *
 * Se puede AVANZAR de a una etapa, RETROCEDER (una negociación que vuelve a propuesta es normal) y
 * cerrar como ganada o perdida desde cualquier etapa abierta — un lead se puede perder sin haber
 * pasado por la propuesta.
 *
 * Lo que NO se puede es reabrir: `won` y `lost` son terminales. Una oportunidad ganada que "vuelve"
 * es otra oportunidad, y dejar mutar la etapa haría que el histórico de conversión mienta.
 */
export function assertStageTransition(from: OpportunityStage, to: OpportunityStage): void {
  if (from === to) throw new InvalidStageTransitionError(`La oportunidad ya está en ${to}`);
  if (isTerminal(from))
    throw new InvalidStageTransitionError(
      `Una oportunidad ${from === 'won' ? 'ganada' : 'perdida'} no se reabre: creá una nueva`,
    );
  if (!OPPORTUNITY_STAGES.includes(to)) throw new InvalidStageTransitionError(`Etapa desconocida: ${to}`);
}

export interface OpportunityLike {
  stage: OpportunityStage;
  /** Valor estimado. `null` cuando todavía no se sabe: no cuenta como 0. */
  value?: number | null;
}

export interface PipelineSummary {
  /** Abiertas: todo lo que no está cerrado. */
  open: number;
  won: number;
  lost: number;
  /** Suma de los valores de las abiertas. `null` si ninguna tiene valor cargado. */
  openValue: number | null;
  /** Lo mismo, ponderado por la probabilidad de la etapa. */
  weightedValue: number | null;
  /** Abiertas SIN valor: mide cuánto del pipeline no se puede sumar. */
  openWithoutValue: number;
  /** Ganadas ÷ cerradas. `null` si todavía no cerró ninguna. */
  winRate: number | null;
  byStage: Record<OpportunityStage, { count: number; value: number | null }>;
}

/**
 * Resumen del pipeline. Los valores no cargados NO cuentan como cero —igual criterio que el clima:
 * una oportunidad sin monto es una incógnita, no una de cero pesos— y por eso se informa aparte
 * cuántas quedaron fuera de la suma.
 */
export function summarizePipeline(opportunities: OpportunityLike[]): PipelineSummary {
  const byStage = Object.fromEntries(
    OPPORTUNITY_STAGES.map((s) => [s, { count: 0, value: null as number | null }]),
  ) as PipelineSummary['byStage'];

  let open = 0;
  let openValue: number | null = null;
  let weighted: number | null = null;
  let openWithoutValue = 0;

  for (const o of opportunities) {
    const slot = byStage[o.stage];
    if (!slot) continue;
    slot.count++;
    if (o.value != null) slot.value = (slot.value ?? 0) + o.value;

    if (isTerminal(o.stage)) continue;
    open++;
    if (o.value == null) openWithoutValue++;
    else {
      openValue = (openValue ?? 0) + o.value;
      weighted = (weighted ?? 0) + o.value * STAGE_PROBABILITY[o.stage];
    }
  }

  const won = byStage.won.count;
  const lost = byStage.lost.count;
  const cerradas = won + lost;

  return {
    open,
    won,
    lost,
    openValue: round2(openValue),
    weightedValue: round2(weighted),
    openWithoutValue,
    winRate: cerradas === 0 ? null : Math.round((won / cerradas) * 1000) / 10,
    byStage: Object.fromEntries(
      Object.entries(byStage).map(([k, v]) => [k, { ...v, value: round2(v.value) }]),
    ) as PipelineSummary['byStage'],
  };
}

function round2(n: number | null): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}
