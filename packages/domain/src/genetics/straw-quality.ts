/**
 * ¿Esta partida de semen sirve para inseminar?
 *
 * **Lo primero, para no mentir: el semen NO se echa a perder con el tiempo.** Bien conservado en
 * nitrógeno líquido a −196 °C dura décadas — hay terneros nacidos de pajuelas de los años setenta.
 * Un sistema que avise «semen vencido» por el calendario estaría inventando un problema, y peor:
 * enseñaría a ignorar los avisos.
 *
 * Lo que sí existe son dos cosas distintas, y por eso acá hay dos conceptos separados:
 *
 * 1. **El vencimiento ADMINISTRATIVO.** El certificado sanitario, el permiso de importación, la
 *    habilitación del centro que la produjo. Vencido eso, la pajuela sigue siendo buena pero no se
 *    puede usar legalmente ni vender el ternero como corresponde. Es una fecha que pone el
 *    proveedor, no una propiedad biológica.
 *
 * 2. **La calidad REAL, que se mide descongelando una.** Motilidad post-descongelado: se descongela
 *    una pajuela, se mira al microscopio y se cuenta qué porcentaje de espermatozoides se mueve.
 *    Es lo único que detecta el problema que de verdad arruina una partida — que el termo se haya
 *    quedado sin nitrógeno y las pajuelas se hayan descongelado y vuelto a congelar.
 *
 * El umbral de 30% es el de referencia para inseminación artificial. Entra como parámetro con
 * default documentado, igual que las alícuotas de IVA o los coeficientes de edad de madre: cada
 * laboratorio y cada raza pueden tener el suyo.
 *
 * Puro, sin IO ni relojes.
 */

/** Motilidad post-descongelado mínima para considerar una partida apta para IA. */
export const MIN_POST_THAW_MOTILITY_PCT = 30;

/** Por debajo de esto no hay discusión: la partida no sirve. */
export const MOTILITY_DISCARD_PCT = 15;

export type QualityVerdict = 'apta' | 'dudosa' | 'descartar';

/**
 * Qué decir de una motilidad medida.
 *
 * «Dudosa» no es tibieza: entre el 15% y el 30% la partida puede preñar, con peor tasa. El productor
 * puede decidir usarla en vacas de descarte y no en las mejores, y para eso necesita el matiz — un
 * apto/no-apto lo obligaría a tirar semen que todavía sirve para algo.
 */
export function motilityVerdict(pct: number, umbral: number = MIN_POST_THAW_MOTILITY_PCT): QualityVerdict {
  if (!Number.isFinite(pct)) return 'dudosa';
  if (pct >= umbral) return 'apta';
  if (pct >= MOTILITY_DISCARD_PCT) return 'dudosa';
  return 'descartar';
}

export interface QualityCheck {
  /** `YYYY-MM-DD` de cuándo se descongeló la pajuela de prueba. */
  readonly checkedAt: string;
  readonly motilityPct: number;
}

export interface BatchUsabilityInput {
  /** Vencimiento administrativo declarado por el proveedor. `null` si no lo informó. */
  readonly expiryDate?: string | null;
  /** La ÚLTIMA prueba de calidad, si hay alguna. */
  readonly lastCheck?: QualityCheck | null;
  /** Hoy, en el día de la finca. */
  readonly today: string;
  readonly umbralMotilidad?: number;
}

export type UsabilityLevel = 'ok' | 'warning' | 'blocked';

export interface BatchUsability {
  readonly level: UsabilityLevel;
  /** `true` si conviene frenar el uso: la prueba dio mal o el permiso está vencido. */
  readonly blocks: boolean;
  /** Los motivos, en castellano y listos para mostrar. Vacío cuando no hay nada que decir. */
  readonly reasons: readonly string[];
  readonly verdict: QualityVerdict | null;
  /** Días hasta el vencimiento administrativo; negativo si ya pasó. `null` sin fecha. */
  readonly daysToExpiry: number | null;
}

/** Días entre dos fechas calendario. Sin husos: las dos son fechas, no instantes. */
function dias(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Con cuánta anticipación avisar del vencimiento administrativo: un trámite lleva tiempo. */
const AVISO_VENCIMIENTO_DIAS = 60;

/**
 * El estado de una partida, juntando el permiso y la última prueba.
 *
 * Una partida SIN prueba no se marca como problema. Es lo normal: la mayoría del semen nunca se
 * prueba y anda perfecto. Avisar por no haberla probado convertiría el aviso en ruido de fondo, y
 * la próxima vez que diga algo de verdad nadie lo va a leer.
 */
export function batchUsability(input: BatchUsabilityInput): BatchUsability {
  const reasons: string[] = [];
  let level: UsabilityLevel = 'ok';
  let blocks = false;

  const daysToExpiry = input.expiryDate ? dias(input.today, input.expiryDate) : null;
  if (daysToExpiry !== null) {
    if (daysToExpiry < 0) {
      reasons.push(`Permiso vencido hace ${Math.abs(daysToExpiry)} días. La pajuela sigue siendo buena; lo que caducó es la habilitación.`);
      level = 'blocked';
      blocks = true;
    } else if (daysToExpiry <= AVISO_VENCIMIENTO_DIAS) {
      reasons.push(`El permiso vence en ${daysToExpiry} días: renovarlo o usar la partida antes.`);
      level = 'warning';
    }
  }

  const verdict = input.lastCheck ? motilityVerdict(input.lastCheck.motilityPct, input.umbralMotilidad) : null;
  if (input.lastCheck && verdict === 'descartar') {
    reasons.push(`La última prueba dio ${input.lastCheck.motilityPct}% de motilidad: la partida no sirve para inseminar.`);
    level = 'blocked';
    blocks = true;
  } else if (input.lastCheck && verdict === 'dudosa') {
    reasons.push(`La última prueba dio ${input.lastCheck.motilityPct}% de motilidad: puede preñar, con peor tasa.`);
    if (level === 'ok') level = 'warning';
  }

  return { level, blocks, reasons, verdict, daysToExpiry };
}
