import { describe, it, expect } from 'vitest';
import {
  InvalidStageTransitionError,
  assertStageTransition,
  isTerminal,
  summarizePipeline,
  type OpportunityLike,
} from './pipeline';

const op = (stage: OpportunityLike['stage'], value?: number | null): OpportunityLike => ({ stage, value });

describe('assertStageTransition', () => {
  it('avanza de a una etapa', () => {
    expect(() => assertStageTransition('lead', 'qualified')).not.toThrow();
    expect(() => assertStageTransition('proposal', 'negotiation')).not.toThrow();
  });

  // Una negociación que vuelve a propuesta es normal en la vida real.
  it('permite retroceder', () => {
    expect(() => assertStageTransition('negotiation', 'proposal')).not.toThrow();
  });

  it('permite cerrar desde cualquier etapa abierta: un lead se puede perder sin propuesta', () => {
    expect(() => assertStageTransition('lead', 'lost')).not.toThrow();
    expect(() => assertStageTransition('qualified', 'won')).not.toThrow();
  });

  // Dejar reabrir haría que el histórico de conversión mienta.
  it('no reabre lo cerrado', () => {
    expect(() => assertStageTransition('won', 'negotiation')).toThrow(InvalidStageTransitionError);
    expect(() => assertStageTransition('lost', 'lead')).toThrow(/no se reabre/);
  });

  it('rechaza quedarse en la misma etapa y las etapas inventadas', () => {
    expect(() => assertStageTransition('lead', 'lead')).toThrow(/ya está/);
    expect(() => assertStageTransition('lead', 'ganada' as never)).toThrow(/desconocida/);
  });

  it('sabe cuáles son terminales', () => {
    expect(isTerminal('won')).toBe(true);
    expect(isTerminal('lost')).toBe(true);
    expect(isTerminal('negotiation')).toBe(false);
  });
});

describe('summarizePipeline', () => {
  it('cuenta abiertas, ganadas y perdidas', () => {
    const r = summarizePipeline([op('lead'), op('proposal'), op('won'), op('lost'), op('lost')]);
    expect(r).toMatchObject({ open: 2, won: 1, lost: 2 });
  });

  // Sin ponderar, diez charlas iniciales "valen" lo mismo que diez contratos por firmarse.
  it('pondera por la probabilidad de la etapa', () => {
    const r = summarizePipeline([op('lead', 1000), op('negotiation', 1000)]);
    expect(r.openValue).toBe(2000);
    expect(r.weightedValue).toBe(850); // 1000·0.10 + 1000·0.75
  });

  it('lo cerrado no entra al pipeline abierto', () => {
    const r = summarizePipeline([op('won', 5000), op('lost', 3000), op('proposal', 1000)]);
    expect(r.openValue).toBe(1000);
    expect(r.weightedValue).toBe(500);
  });

  // Una oportunidad sin monto es una incógnita, no una de cero pesos.
  it('las abiertas sin valor no suman como cero y se informan aparte', () => {
    const r = summarizePipeline([op('proposal', 1000), op('proposal', null), op('lead')]);
    expect(r.openValue).toBe(1000);
    expect(r.openWithoutValue).toBe(2);
  });

  it('si NINGUNA abierta tiene valor, el total es null y no 0', () => {
    const r = summarizePipeline([op('lead'), op('qualified')]);
    expect(r.openValue).toBeNull();
    expect(r.weightedValue).toBeNull();
    expect(r.openWithoutValue).toBe(2);
  });

  it('la tasa de conversión mira solo lo cerrado', () => {
    expect(summarizePipeline([op('won'), op('won'), op('lost'), op('lead')]).winRate).toBe(66.7);
  });

  it('sin cierres todavía, la tasa es null (no 0 %)', () => {
    expect(summarizePipeline([op('lead'), op('proposal')]).winRate).toBeNull();
  });

  it('desglosa por etapa', () => {
    const r = summarizePipeline([op('lead', 100), op('lead', 200), op('won', 900)]);
    expect(r.byStage.lead).toEqual({ count: 2, value: 300 });
    expect(r.byStage.won).toEqual({ count: 1, value: 900 });
    expect(r.byStage.proposal).toEqual({ count: 0, value: null });
  });

  it('un pipeline vacío no rompe', () => {
    expect(summarizePipeline([])).toMatchObject({ open: 0, won: 0, lost: 0, openValue: null, winRate: null });
  });
});
