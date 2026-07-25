import { describe, it, expect } from 'vitest';
import {
  dailyThi,
  growingDegreeDays,
  heatStressLevel,
  isFrost,
  meanTemp,
  temperatureHumidityIndex,
  waterBalanceMm,
} from './agroclimate';

const dia = (d: Partial<Parameters<typeof meanTemp>[0]> = {}) => ({ date: '2026-01-15', ...d });

describe('meanTemp', () => {
  it('prefiere la media medida sobre el promedio de extremos', () => {
    expect(meanTemp(dia({ tempMeanC: 21, tempMinC: 10, tempMaxC: 30 }))).toBe(21);
  });

  it('promedia mínima y máxima si no hay media', () => {
    expect(meanTemp(dia({ tempMinC: 10, tempMaxC: 30 }))).toBe(20);
  });

  it('sin temperatura devuelve null (una estación puede medir solo lluvia)', () => {
    expect(meanTemp(dia({ rainMm: 12 }))).toBeNull();
  });
});

describe('growingDegreeDays', () => {
  it('acumula lo que supera la base del cultivo', () => {
    expect(growingDegreeDays(dia({ tempMinC: 12, tempMaxC: 28 }), { baseC: 10 })).toBe(10);
  });

  it('un día frío no resta: el mínimo es 0', () => {
    expect(growingDegreeDays(dia({ tempMinC: 2, tempMaxC: 8 }), { baseC: 10 })).toBe(0);
  });

  // Método modificado: por encima del tope el cultivo no crece más, y seguir sumando sobreestimaría.
  it('el tope recorta la máxima antes de promediar', () => {
    expect(growingDegreeDays(dia({ tempMinC: 20, tempMaxC: 40 }), { baseC: 10, capC: 30 })).toBe(15);
    expect(growingDegreeDays(dia({ tempMinC: 20, tempMaxC: 40 }), { baseC: 10 })).toBe(20);
  });

  // "No sé" y "no hubo crecimiento" son cosas distintas: devolver 0 arruinaría el acumulado.
  it('sin temperatura devuelve null, no 0', () => {
    expect(growingDegreeDays(dia({ rainMm: 5 }), { baseC: 10 })).toBeNull();
  });
});

describe('temperatureHumidityIndex', () => {
  // A igual temperatura, más humedad = menos evaporación = más calor sentido.
  it('sube con la humedad a temperatura constante', () => {
    expect(temperatureHumidityIndex(30, 80)).toBeGreaterThan(temperatureHumidityIndex(30, 30));
  });

  it('sube con la temperatura a humedad constante', () => {
    expect(temperatureHumidityIndex(35, 50)).toBeGreaterThan(temperatureHumidityIndex(25, 50));
  });

  it('coincide con la fórmula NRC en un punto conocido', () => {
    // 30 °C y 50 % → 1.8·30+32 − (0.55−0.0055·50)·(1.8·30−26) = 86 − 0.275·28 = 78.3
    expect(temperatureHumidityIndex(30, 50)).toBe(78.3);
  });

  it('acota la humedad al rango físico en vez de propagar un valor imposible', () => {
    expect(temperatureHumidityIndex(30, 150)).toBe(temperatureHumidityIndex(30, 100));
    expect(temperatureHumidityIndex(30, -20)).toBe(temperatureHumidityIndex(30, 0));
  });
});

describe('heatStressLevel', () => {
  // Lo que hace que el tambo vea la alerta a tiempo: la lechera sufre mucho antes que el novillo.
  it('la lechera entra en estrés antes que la carne, con el mismo THI', () => {
    expect(heatStressLevel(70, 'dairy')).toBe('mild');
    expect(heatStressLevel(70, 'beef')).toBe('none');
    expect(heatStressLevel(82, 'dairy')).toBe('severe');
    expect(heatStressLevel(82, 'beef')).toBe('moderate');
  });

  it('escala completa para carne', () => {
    expect(heatStressLevel(60)).toBe('none');
    expect(heatStressLevel(76)).toBe('mild');
    expect(heatStressLevel(80)).toBe('moderate');
    expect(heatStressLevel(85)).toBe('severe');
    expect(heatStressLevel(95)).toBe('emergency');
  });

  it('el umbral es inclusivo: justo en el borde ya cuenta', () => {
    expect(heatStressLevel(75, 'beef')).toBe('mild');
    expect(heatStressLevel(74.9, 'beef')).toBe('none');
  });
});

describe('dailyThi', () => {
  // El estrés se evalúa en el peor momento del día, no en el promedio.
  it('usa la máxima del día', () => {
    expect(dailyThi(dia({ tempMinC: 18, tempMaxC: 34, humidityPct: 60 }))).toBe(
      temperatureHumidityIndex(34, 60),
    );
  });

  it('sin humedad no se calcula (un termómetro solo no alcanza)', () => {
    expect(dailyThi(dia({ tempMaxC: 34 }))).toBeNull();
  });
});

describe('waterBalanceMm', () => {
  it('lluvia menos evapotranspiración', () => {
    expect(waterBalanceMm(dia({ rainMm: 20, etpMm: 6.5 }))).toBe(13.5);
    expect(waterBalanceMm(dia({ rainMm: 0, etpMm: 7 }))).toBe(-7);
  });

  // Asumir ETP 0 daría un balance falsamente optimista justo en verano, que es cuando se mira.
  it('sin ETP no se inventa el balance', () => {
    expect(waterBalanceMm(dia({ rainMm: 20 }))).toBeNull();
  });
});

describe('isFrost', () => {
  it('helada meteorológica por defecto (≤ 0 °C)', () => {
    expect(isFrost(dia({ tempMinC: -1 }))).toBe(true);
    expect(isFrost(dia({ tempMinC: 0 }))).toBe(true);
    expect(isFrost(dia({ tempMinC: 1 }))).toBe(false);
  });

  it('umbral configurable para la helada agronómica', () => {
    expect(isFrost(dia({ tempMinC: 2.5 }), 3)).toBe(true);
  });

  it('sin mínima no afirma que heló', () => {
    expect(isFrost(dia({ tempMaxC: 30 }))).toBe(false);
  });
});
