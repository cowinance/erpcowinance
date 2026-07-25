import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFILL_LEAD_DAYS,
  InvalidNitrogenError,
  computeNitrogenState,
  nitrogenAlertMessage,
  validateReading,
  validateRefill,
} from './nitrogen';

const r = (reading_date: string, level_cm: number) => ({ reading_date, level_cm });

describe('computeNitrogenState', () => {
  it('proyecta la fecha de vacío a partir de la caída entre mediciones', () => {
    // 20 cm en 10 días = 2 cm/día; quedan 30 cm → 15 días.
    const s = computeNitrogenState([r('2026-06-01', 50), r('2026-06-11', 30)], null);
    expect(s.daily_cm).toBe(2);
    expect(s.days_remaining).toBe(15);
    expect(s.projected_empty_date).toBe('2026-06-26');
  });

  /**
   * La regla que sostiene todo GT-4: el consumo SOLO se puede medir entre recargas. Mezclar
   * mediciones de antes y de después de una recarga daría un consumo negativo —el termo «ganando»
   * nitrógeno— y una proyección sin sentido, justo en el dato del que depende no perder la genética.
   */
  it('descarta las mediciones anteriores a la última recarga', () => {
    const mediciones = [r('2026-06-01', 50), r('2026-06-11', 30), r('2026-06-12', 90), r('2026-06-22', 70)];
    const s = computeNitrogenState(mediciones, '2026-06-12');
    // Solo el ciclo nuevo: 20 cm en 10 días. Sin el filtro, la caída se calcularía contra los 50 cm
    // del ciclo anterior y daría un consumo negativo.
    expect(s.daily_cm).toBe(2);
    expect(s.days_remaining).toBe(35);
  });

  /**
   * El umbral es sobre los DÍAS QUE QUEDAN, no sobre el nivel: un termo al 20 % puede estar
   * tranquilo si consume poco, y uno al 50 % puede ser urgencia si evapora rápido. Lo que decide es
   * si todavía se llega a pedir y recibir la recarga.
   */
  it('el estado depende del tiempo de reposición, no del nivel', () => {
    // Mismo nivel final (30 cm), consumos distintos.
    const lento = computeNitrogenState([r('2026-06-01', 40), r('2026-06-11', 30)], null); // 1 cm/día → 30 días
    const rapido = computeNitrogenState([r('2026-06-01', 90), r('2026-06-11', 30)], null); // 6 cm/día → 5 días
    expect(lento.status).toBe('ok');
    expect(rapido.status).toBe('critical');
    expect(lento.level_cm).toBe(rapido.level_cm);
  });

  it('avisa antes de que pedir llegue tarde', () => {
    const leadDays = DEFAULT_REFILL_LEAD_DAYS;
    // 20 días restantes con 14 de reposición: todavía se llega, pero hay que pedir ya.
    const s = computeNitrogenState([r('2026-06-01', 40), r('2026-06-11', 20)], null, leadDays);
    expect(s.days_remaining).toBe(10);
    expect(s.status).toBe('critical');
    const holgado = computeNitrogenState([r('2026-06-01', 100), r('2026-06-11', 95)], null, leadDays);
    expect(holgado.days_remaining).toBe(190);
    expect(holgado.status).toBe('ok');
  });

  // Con una sola medición no hay consumo que medir, y decirlo es más útil que devolver 'ok'.
  it('sin dos mediciones del ciclo no proyecta, y explica por qué', () => {
    const s = computeNitrogenState([r('2026-06-12', 90)], '2026-06-12');
    expect(s.status).toBe('unknown');
    expect(s.days_remaining).toBeNull();
    expect(s.level_cm).toBe(90); // el nivel sí se conoce
    expect(s.reason).toMatch(/segunda medición/);
  });

  it('sin ninguna medición lo dice, en vez de aparentar que está bien', () => {
    const s = computeNitrogenState([], null);
    expect(s).toMatchObject({ status: 'unknown', level_cm: null, days_remaining: null });
    expect(s.reason).toMatch(/ninguna medición/);
  });

  /**
   * Un nivel que no baja suele ser una recarga sin registrar. Inventar una fecha de vacío a partir
   * de eso sería peor que decir que no se sabe.
   */
  it('si el nivel no bajó, no inventa una proyección', () => {
    const s = computeNitrogenState([r('2026-06-01', 50), r('2026-06-11', 50)], null);
    expect(s.status).toBe('unknown');
    expect(s.projected_empty_date).toBeNull();
    expect(s.reason).toMatch(/recarga/);
  });

  it('dos mediciones del mismo día no alcanzan', () => {
    const s = computeNitrogenState([r('2026-06-01', 50), r('2026-06-01', 48)], null);
    expect(s.status).toBe('unknown');
    expect(s.reason).toMatch(/mismo día/);
  });

  it('toma la última medición aunque lleguen desordenadas', () => {
    const s = computeNitrogenState([r('2026-06-11', 30), r('2026-06-01', 50)], null);
    expect(s.last_reading_date).toBe('2026-06-11');
    expect(s.level_cm).toBe(30);
  });
});

describe('nitrogenAlertMessage', () => {
  // El mensaje dice la CONSECUENCIA, no el número: «quedan 9 días» no explica por qué hay que
  // soltar lo que se está haciendo.
  it('en crítico nombra la pérdida y el plazo del proveedor', () => {
    const s = computeNitrogenState([r('2026-06-01', 40), r('2026-06-11', 20)], null);
    const m = nitrogenAlertMessage(s, '207');
    expect(m).toMatch(/Termo 207/);
    expect(m).toMatch(/se pierde todo lo que hay adentro/);
    expect(m).toMatch(/14/);
  });

  it('en aviso pide la recarga sin dramatizar', () => {
    const s = computeNitrogenState([r('2026-06-01', 50), r('2026-06-11', 30)], null);
    expect(s.status).toBe('warning');
    expect(nitrogenAlertMessage(s, '207')).toMatch(/Conviene pedir la recarga/);
  });

  it('sin proyección lo dice en vez de alarmar', () => {
    expect(nitrogenAlertMessage(computeNitrogenState([], null), '003')).toMatch(/sin datos suficientes/);
  });
});

describe('validaciones', () => {
  it('la medición exige fecha y nivel no negativo', () => {
    expect(validateReading({ reading_date: '2026-06-11T10:00:00Z', level_cm: '30' })).toEqual({
      reading_date: '2026-06-11',
      level_cm: 30,
    });
    expect(() => validateReading({ level_cm: 30 })).toThrow(InvalidNitrogenError);
    expect(() => validateReading({ reading_date: '2026-06-11', level_cm: -1 })).toThrow(/level_cm/);
  });

  it('la recarga exige litros mayores que cero', () => {
    expect(validateRefill({ refill_date: '2026-06-12', liters: 30, level_after_cm: '' })).toEqual({
      refill_date: '2026-06-12',
      liters: 30,
      level_after_cm: null,
    });
    expect(() => validateRefill({ refill_date: '2026-06-12', liters: 0 })).toThrow(/liters/);
    expect(() => validateRefill({ liters: 30 })).toThrow(/refill_date/);
  });
});
