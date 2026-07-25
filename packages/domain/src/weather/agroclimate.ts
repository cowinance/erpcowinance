/**
 * Índices agroclimáticos (D4). Reglas puras: las mismas fórmulas para el resumen de la web, las
 * alertas y cualquier consumidor futuro.
 *
 * Todos los umbrales están NOMBRADOS y documentados con su fuente. Un número mágico en un índice
 * agronómico es peor que en otro lado: parece preciso, nadie lo cuestiona, y decide si se mueve la
 * hacienda o no.
 */

/** Observación diaria. Todo opcional salvo la fecha: una estación puede medir solo lluvia. */
export interface DailyWeather {
  /** `YYYY-MM-DD`. */
  date: string;
  tempMinC?: number | null;
  tempMaxC?: number | null;
  tempMeanC?: number | null;
  rainMm?: number | null;
  humidityPct?: number | null;
  windKmh?: number | null;
  /** Evapotranspiración potencial. Si no viene, el balance hídrico no se calcula (no se inventa). */
  etpMm?: number | null;
}

/** Temperatura media del día: la medida si existe, si no el promedio de mínima y máxima. */
export function meanTemp(day: DailyWeather): number | null {
  if (day.tempMeanC != null) return day.tempMeanC;
  if (day.tempMinC != null && day.tempMaxC != null) return (day.tempMinC + day.tempMaxC) / 2;
  return null;
}

export interface GddOptions {
  /** Temperatura base del cultivo: por debajo no hay crecimiento. Maíz y soja: 10 °C. */
  baseC: number;
  /**
   * Tope de la máxima ("método modificado"): por encima el cultivo tampoco crece más, así que
   * seguir sumando sobreestimaría. Para maíz se usa 30 °C. Sin tope, se suma la media cruda.
   */
  capC?: number;
}

/**
 * Grados-día de crecimiento del día. `null` si no hay temperatura suficiente — no 0: "no sé" y
 * "no hubo crecimiento" son cosas distintas, y confundirlas arruina el acumulado.
 */
export function growingDegreeDays(day: DailyWeather, opts: GddOptions): number | null {
  const cap = opts.capC;
  const min = day.tempMinC;
  const max = day.tempMaxC;

  const media =
    min != null && max != null ? (Math.min(max, cap ?? max) + Math.min(min, cap ?? min)) / 2 : meanTemp(day);
  if (media == null) return null;
  return Math.max(0, round1(media - opts.baseC));
}

/**
 * Índice de temperatura y humedad (THI). Mide el calor que EFECTIVAMENTE siente el animal: a igual
 * temperatura, más humedad significa menos capacidad de disipar calor por evaporación, así que un
 * termómetro solo subestima el estrés.
 *
 * Fórmula clásica (NRC 1971), en uso general para bovinos:
 *   THI = (1.8·T + 32) − (0.55 − 0.0055·HR) · (1.8·T − 26)
 */
export function temperatureHumidityIndex(tempC: number, humidityPct: number): number {
  const hr = clamp(humidityPct, 0, 100);
  return round1(1.8 * tempC + 32 - (0.55 - 0.0055 * hr) * (1.8 * tempC - 26));
}

export type HeatStress = 'none' | 'mild' | 'moderate' | 'severe' | 'emergency';

/**
 * Sistema productivo. NO es un detalle: **la vaca lechera en producción empieza a sufrir mucho
 * antes** que un novillo a campo —genera más calor metabólico— y usar una sola escala haría que el
 * tambo no viera nunca una alerta hasta que ya hubiera caído la producción.
 *
 * · `dairy` — umbrales de Armstrong (1994), los de uso corriente en lechería.
 * · `beef`  — Livestock Weather Safety Index, el estándar para carne a campo y feedlot.
 */
export type ProductionSystem = 'dairy' | 'beef';

const THI_THRESHOLDS: Record<ProductionSystem, { mild: number; moderate: number; severe: number; emergency: number }> = {
  dairy: { mild: 68, moderate: 72, severe: 80, emergency: 90 },
  beef: { mild: 75, moderate: 79, severe: 84, emergency: 89 },
};

export function heatStressLevel(thi: number, system: ProductionSystem = 'beef'): HeatStress {
  const t = THI_THRESHOLDS[system];
  if (thi >= t.emergency) return 'emergency';
  if (thi >= t.severe) return 'severe';
  if (thi >= t.moderate) return 'moderate';
  if (thi >= t.mild) return 'mild';
  return 'none';
}

/** THI del día, calculado en el momento MÁS EXIGENTE: la máxima del día con su humedad. */
export function dailyThi(day: DailyWeather): number | null {
  const temp = day.tempMaxC ?? meanTemp(day);
  if (temp == null || day.humidityPct == null) return null;
  return temperatureHumidityIndex(temp, day.humidityPct);
}

/**
 * Balance hídrico del día: lo que entró menos lo que se fue. Positivo = recarga; negativo =
 * déficit. `null` si falta cualquiera de los dos — asumir ETP 0 daría un balance falsamente
 * optimista justo en verano, que es cuando se mira.
 */
export function waterBalanceMm(day: DailyWeather): number | null {
  if (day.rainMm == null || day.etpMm == null) return null;
  return round1(day.rainMm - day.etpMm);
}

/** Helada. El default es 0 °C (helada meteorológica); la agronómica se configura con 3 °C. */
export function isFrost(day: DailyWeather, thresholdC = 0): boolean {
  return day.tempMinC != null && day.tempMinC <= thresholdC;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
