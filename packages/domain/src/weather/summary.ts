import {
  type DailyWeather,
  type GddOptions,
  type HeatStress,
  type ProductionSystem,
  dailyThi,
  growingDegreeDays,
  heatStressLevel,
  isFrost,
  waterBalanceMm,
} from './agroclimate';

/**
 * Resumen agroclimático de un período. Es la fuente única de los indicadores que pide el catálogo
 * para D4: lluvia acumulada, grados-día, índice de estrés calórico y balance hídrico.
 */
export interface WeatherSummary {
  from: string;
  to: string;
  /** Días con al menos una medición. */
  days: number;
  /** Lluvia acumulada (mm). `null` si ningún día la midió. */
  rainMm: number | null;
  /** Grados-día acumulados. `null` si no hubo temperatura. */
  gdd: number | null;
  /** Balance hídrico acumulado (lluvia − ETP). `null` si falta ETP. */
  waterBalanceMm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  /** THI más alto del período y su nivel. */
  maxThi: number | null;
  maxHeatStress: HeatStress | null;
  /** Días en cada nivel de estrés (solo los que tienen THI calculable). */
  heatStressDays: Record<HeatStress, number>;
  frostDays: number;
  /** Días del período SIN ninguna medición: mide la confianza en todo lo de arriba. */
  daysWithoutData: number;
}

export interface SummaryOptions {
  gdd?: GddOptions;
  system?: ProductionSystem;
  frostThresholdC?: number;
  /** Días esperados en el período; sirve para informar la cobertura de datos. */
  expectedDays?: number;
}

/**
 * Agrega observaciones diarias. Los acumulados suman SOLO los días que midieron: un día sin
 * pluviómetro no es un día sin lluvia, y tratarlo como cero convertiría una estación con fallas en
 * una sequía inventada. Por eso también se informa `daysWithoutData`: el número y su confianza
 * viajan juntos.
 */
export function summarizeWeather(
  days: DailyWeather[],
  from: string,
  to: string,
  opts: SummaryOptions = {},
): WeatherSummary {
  const sistema = opts.system ?? 'beef';
  const heatStressDays: Record<HeatStress, number> = { none: 0, mild: 0, moderate: 0, severe: 0, emergency: 0 };

  let rain: number | null = null;
  let gdd: number | null = null;
  let balance: number | null = null;
  let tempMin: number | null = null;
  let tempMax: number | null = null;
  let maxThi: number | null = null;
  let frost = 0;

  for (const d of days) {
    if (d.rainMm != null) rain = (rain ?? 0) + d.rainMm;

    if (opts.gdd) {
      const g = growingDegreeDays(d, opts.gdd);
      if (g != null) gdd = (gdd ?? 0) + g;
    }

    const wb = waterBalanceMm(d);
    if (wb != null) balance = (balance ?? 0) + wb;

    if (d.tempMinC != null) tempMin = tempMin == null ? d.tempMinC : Math.min(tempMin, d.tempMinC);
    if (d.tempMaxC != null) tempMax = tempMax == null ? d.tempMaxC : Math.max(tempMax, d.tempMaxC);

    const thi = dailyThi(d);
    if (thi != null) {
      maxThi = maxThi == null ? thi : Math.max(maxThi, thi);
      heatStressDays[heatStressLevel(thi, sistema)]++;
    }

    if (isFrost(d, opts.frostThresholdC ?? 0)) frost++;
  }

  const esperados = opts.expectedDays ?? days.length;
  return {
    from,
    to,
    days: days.length,
    rainMm: rain == null ? null : round1(rain),
    gdd: gdd == null ? null : round1(gdd),
    waterBalanceMm: balance == null ? null : round1(balance),
    tempMinC: tempMin,
    tempMaxC: tempMax,
    maxThi,
    maxHeatStress: maxThi == null ? null : heatStressLevel(maxThi, sistema),
    heatStressDays,
    frostDays: frost,
    daysWithoutData: Math.max(0, esperados - days.length),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
