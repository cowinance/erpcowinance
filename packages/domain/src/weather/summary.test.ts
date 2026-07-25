import { describe, it, expect } from 'vitest';
import { summarizeWeather } from './summary';
import type { DailyWeather } from './agroclimate';

const RANGO = ['2026-01-01', '2026-01-05'] as const;
const resumen = (days: DailyWeather[], opts = {}) => summarizeWeather(days, RANGO[0], RANGO[1], opts);

describe('summarizeWeather', () => {
  it('acumula lluvia y guarda los extremos de temperatura', () => {
    const r = resumen([
      { date: '2026-01-01', rainMm: 12, tempMinC: 14, tempMaxC: 29 },
      { date: '2026-01-02', rainMm: 0, tempMinC: 11, tempMaxC: 33 },
      { date: '2026-01-03', rainMm: 8.5, tempMinC: 16, tempMaxC: 26 },
    ]);
    expect(r.rainMm).toBe(20.5);
    expect(r.tempMinC).toBe(11);
    expect(r.tempMaxC).toBe(33);
    expect(r.days).toBe(3);
  });

  // El corazón del resumen: un día sin pluviómetro NO es un día sin lluvia. Tratarlo como cero
  // convertiría una estación con fallas en una sequía inventada.
  it('los días sin medición no cuentan como cero', () => {
    const r = resumen([{ date: '2026-01-01', rainMm: 30 }, { date: '2026-01-02' }]);
    expect(r.rainMm).toBe(30);
  });

  it('si NADIE midió algo, el indicador es null y no 0', () => {
    const r = resumen([{ date: '2026-01-01', tempMinC: 10, tempMaxC: 20 }]);
    expect(r.rainMm).toBeNull();
    expect(r.waterBalanceMm).toBeNull();
    expect(r.gdd).toBeNull(); // sin opciones de GDD no se calcula
  });

  // El número y su confianza viajan juntos: 20 mm en 5 días medidos no es lo mismo que en 1.
  it('informa cuántos días del período quedaron sin datos', () => {
    const r = resumen([{ date: '2026-01-01', rainMm: 20 }], { expectedDays: 5 });
    expect(r.daysWithoutData).toBe(4);
  });

  it('acumula grados-día cuando se indica el cultivo', () => {
    const r = resumen(
      [
        { date: '2026-01-01', tempMinC: 12, tempMaxC: 28 }, // 10
        { date: '2026-01-02', tempMinC: 14, tempMaxC: 30 }, // 12
        { date: '2026-01-03', tempMinC: 2, tempMaxC: 8 }, // 0
      ],
      { gdd: { baseC: 10 } },
    );
    expect(r.gdd).toBe(22);
  });

  it('acumula el balance hídrico solo con los días que tienen ETP', () => {
    const r = resumen([
      { date: '2026-01-01', rainMm: 20, etpMm: 5 }, // +15
      { date: '2026-01-02', rainMm: 0, etpMm: 7 }, // −7
      { date: '2026-01-03', rainMm: 10 }, // sin ETP: no entra
    ]);
    expect(r.waterBalanceMm).toBe(8);
    expect(r.rainMm).toBe(30);
  });

  it('cuenta los días por nivel de estrés y guarda el pico', () => {
    const r = resumen([
      { date: '2026-01-01', tempMaxC: 22, humidityPct: 50 }, // THI bajo
      { date: '2026-01-02', tempMaxC: 32, humidityPct: 70 },
      { date: '2026-01-03', tempMaxC: 38, humidityPct: 80 },
    ]);
    expect(r.heatStressDays.none).toBe(1);
    expect(r.maxThi).toBeGreaterThan(85);
    expect(r.maxHeatStress).toBe('emergency');
    expect(Object.values(r.heatStressDays).reduce((a, b) => a + b, 0)).toBe(3);
  });

  // 24 °C con 65 % da THI 71.9: la lechera ya está en estrés leve (umbral 68) y el novillo todavía
  // no (umbral 75). Con una sola escala, el tambo no vería nada hasta que ya hubiera caído la
  // producción.
  it('el sistema productivo cambia el conteo con los MISMOS datos', () => {
    const dias: DailyWeather[] = [{ date: '2026-01-01', tempMaxC: 24, humidityPct: 65 }];
    expect(resumen(dias, { system: 'dairy' })).toMatchObject({ maxThi: 71.9, maxHeatStress: 'mild' });
    expect(resumen(dias, { system: 'beef' })).toMatchObject({ maxThi: 71.9, maxHeatStress: 'none' });
  });

  it('cuenta las heladas con el umbral configurado', () => {
    const dias: DailyWeather[] = [
      { date: '2026-06-01', tempMinC: -2 },
      { date: '2026-06-02', tempMinC: 2 },
      { date: '2026-06-03', tempMinC: 8 },
    ];
    expect(resumen(dias).frostDays).toBe(1);
    expect(resumen(dias, { frostThresholdC: 3 }).frostDays).toBe(2);
  });

  it('un período sin observaciones no rompe: todo null o cero, y lo dice', () => {
    const r = resumen([], { expectedDays: 5 });
    expect(r).toMatchObject({ days: 0, rainMm: null, maxThi: null, maxHeatStress: null, frostDays: 0, daysWithoutData: 5 });
  });
});
