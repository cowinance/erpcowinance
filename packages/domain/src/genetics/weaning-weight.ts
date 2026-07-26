/**
 * Peso al destete AJUSTADO y comparación entre genéticas (Fase 2).
 *
 * **El punto que separa esto de un promedio ingenuo:** los pesos al destete crudos NO se pueden
 * comparar. Un ternero pesa más que otro por razones que no son genética:
 *
 *   · nació antes y tiene 40 días más de pasto
 *   · es macho
 *   · su madre es adulta y no una vaquillona de primer parto
 *
 * Comparar sin corregir eso es comparar circunstancia, y lleva a comprar el semen equivocado.
 *
 * El ajuste estándar lleva todos los pesos a una edad común (205 días) interpolando la ganancia
 * diaria desde el nacimiento, y después corrige por edad de la madre. Es la práctica que usan las
 * asociaciones de raza.
 *
 *   ajustado = (peso destete − peso nacer) / edad_días × 205 + peso nacer + ajuste_edad_madre
 *
 * **Los coeficientes de edad de madre son una CONVENCIÓN, no una ley física**, y cada asociación de
 * raza publica los suyos. Por eso entran como parámetro con un default documentado, igual que las
 * alícuotas de IVA: si la asociación del productor usa otros, se cambian sin tocar código.
 *
 * Puro, sin IO ni fechas del sistema.
 */

/** Edad estándar de destete a la que se llevan todos los pesos. */
export const STANDARD_AGE_DAYS = 205;

/**
 * Sexo tal como viene de la base, sin la marca nominal del value object `Sex`. Se usa el crudo a
 * propósito: esta regla la alimenta una consulta SQL, y obligarla a construir el VO por cada
 * ternero solo para leer una letra sería ceremonia sin ganancia.
 */
export type AnimalSex = 'M' | 'F';

/**
 * Ajuste por edad de la madre, en kg, a sumar al peso interpolado.
 *
 * Una vaquillona de primer parto da menos leche que una vaca adulta, así que su ternero pesa menos
 * por la madre y no por el padre. Sin esta corrección, un toro usado sobre vaquillonas parecería
 * peor de lo que es.
 *
 * Defaults del orden de los publicados por la BIF (Beef Improvement Federation) para carne. Se
 * exponen para poder reemplazarlos por los de la asociación que corresponda.
 */
export interface DamAgeAdjustment {
  /** Edad de la madre en años (2, 3, 4, 5–10, 11+). */
  years: number;
  male: number;
  female: number;
}

export const DEFAULT_DAM_AGE_ADJUSTMENTS: readonly DamAgeAdjustment[] = [
  { years: 2, male: 27, female: 24 },
  { years: 3, male: 18, female: 16 },
  { years: 4, male: 9, female: 8 },
  // 5 a 10 años es la madurez plena: no se ajusta (es la referencia).
  { years: 5, male: 0, female: 0 },
  // A partir de 11 la producción de leche vuelve a caer.
  { years: 11, male: 9, female: 8 },
];

/** Devuelve el ajuste que corresponde a una edad de madre, tomando el tramo aplicable. */
export function damAgeAdjustment(
  damAgeYears: number | null | undefined,
  sex: AnimalSex,
  tabla: readonly DamAgeAdjustment[] = DEFAULT_DAM_AGE_ADJUSTMENTS,
): number {
  // Sin edad de madre no se inventa un ajuste: se deja en cero y el resultado queda marcado como
  // menos comparable (ver `adjusted.complete`). Suponer «adulta» sesgaría a favor de los toros
  // usados sobre vaquillonas, que es justo el error que el ajuste viene a evitar.
  if (damAgeYears == null || !Number.isFinite(damAgeYears)) return 0;
  const ordenada = [...tabla].sort((a, b) => a.years - b.years);
  let aplica = ordenada[0];
  for (const t of ordenada) if (damAgeYears >= t.years) aplica = t;
  return sex === 'M' ? aplica.male : aplica.female;
}

export interface WeaningInput {
  weaningWeightKg: number;
  birthWeightKg: number | null;
  /** Edad del ternero al destete, en días. */
  ageAtWeaningDays: number;
  sex: AnimalSex;
  damAgeYears?: number | null;
}

export interface AdjustedWeaning {
  adjustedKg: number;
  /** Ganancia diaria usada para interpolar, en kg/día. */
  dailyGainKg: number;
  /**
   * `false` si faltó algún dato y hubo que asumir: peso de nacimiento ausente o edad de madre
   * desconocida. El número sigue sirviendo, pero es MENOS comparable y la UI debería decirlo en vez
   * de mostrarlo como si fuera equivalente.
   */
  complete: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Lleva un peso al destete a la edad estándar.
 *
 * Sin peso de nacimiento se usa un valor típico como base de la interpolación. Es una aproximación
 * y por eso baja `complete`: sobre pocos animales el sesgo importa, sobre muchos se diluye.
 */
export function adjustWeaningWeight(
  input: WeaningInput,
  opciones: { defaultBirthWeightKg?: number; damAgeTable?: readonly DamAgeAdjustment[] } = {},
): AdjustedWeaning {
  const edad = Number(input.ageAtWeaningDays);
  const destete = Number(input.weaningWeightKg);
  if (!Number.isFinite(edad) || edad <= 0 || !Number.isFinite(destete))
    throw new RangeError('El peso al destete y la edad en días tienen que ser números positivos');

  const nacerConocido = input.birthWeightKg != null && Number.isFinite(Number(input.birthWeightKg));
  const nacer = nacerConocido ? Number(input.birthWeightKg) : (opciones.defaultBirthWeightKg ?? 35);
  const madreConocida = input.damAgeYears != null && Number.isFinite(Number(input.damAgeYears));

  const gananciaDiaria = (destete - nacer) / edad;
  const ajusteMadre = damAgeAdjustment(input.damAgeYears, input.sex, opciones.damAgeTable);

  return {
    adjustedKg: round1(gananciaDiaria * STANDARD_AGE_DAYS + nacer + ajusteMadre),
    dailyGainKg: Math.round(gananciaDiaria * 1000) / 1000,
    complete: nacerConocido && madreConocida,
  };
}

export interface ContemporaryMember {
  /** Identificador de la genética que se compara (toro, partida de semen). */
  sireId: string;
  adjustedKg: number;
}

export interface SireIndex {
  sireId: string;
  /** Terneros del toro dentro del grupo. */
  n: number;
  meanKg: number;
  /** 100 = el promedio del grupo. 108 = 8% por encima. */
  index: number;
  /** Qué tan en serio tomar el índice, dado cuántos terneros lo sostienen. */
  confidence: 'baja' | 'media' | 'alta';
}

/** Umbrales de confianza. No hay magia: son un modo honesto de no prometer precisión inexistente. */
const CONFIDENCE_LOW = 10;
const CONFIDENCE_HIGH = 30;

export function confidenceFor(n: number): SireIndex['confidence'] {
  if (n < CONFIDENCE_LOW) return 'baja';
  if (n < CONFIDENCE_HIGH) return 'media';
  return 'alta';
}

/**
 * Índice de cada toro DENTRO de un grupo contemporáneo.
 *
 * **El grupo contemporáneo es la otra mitad del ajuste.** Un toro no se juzga contra el promedio
 * histórico de la finca sino contra los terneros que pastaron al lado de los suyos: mismo lote,
 * misma parición, mismo manejo. Un año seco baja a todos por igual, y comparar contra otro año
 * atribuiría a la genética lo que fue el clima.
 *
 * El índice es el promedio del toro sobre el promedio del grupo, por cien. Por construcción, el
 * promedio de los índices ponderado por n da 100 — es una invariante que el test exige.
 */
export function sireIndexes(miembros: ContemporaryMember[]): SireIndex[] {
  const validos = miembros.filter((m) => Number.isFinite(Number(m.adjustedKg)));
  if (!validos.length) return [];

  const mediaGrupo = validos.reduce((s, m) => s + Number(m.adjustedKg), 0) / validos.length;
  if (!(mediaGrupo > 0)) return [];

  const porToro = new Map<string, number[]>();
  for (const m of validos) {
    const arr = porToro.get(m.sireId) ?? [];
    arr.push(Number(m.adjustedKg));
    porToro.set(m.sireId, arr);
  }

  return [...porToro.entries()]
    .map(([sireId, pesos]) => {
      const media = pesos.reduce((s, p) => s + p, 0) / pesos.length;
      return {
        sireId,
        n: pesos.length,
        meanKg: round1(media),
        index: Math.round((media / mediaGrupo) * 100),
        confidence: confidenceFor(pesos.length),
      };
    })
    .sort((a, b) => b.index - a.index);
}
