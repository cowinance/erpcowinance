/**
 * Rendimiento del potrero: kilos de carne por hectárea, con el clima al lado (Fase 3.2).
 *
 * Pastoreo sabe QUIÉN estuvo y CUÁNTO tiempo. Producción sabe cuántos kilos se ganaron. Clima sabe
 * si llovió. Los tres datos existían y ninguno se cruzaba, así que la pregunta que decide la
 * rotación del año siguiente —**qué potrero produce carne y cuál no**— no se podía contestar.
 *
 * El error caro que esta regla existe para evitar: mirar el ranking de kg/ha sin el clima y sacar
 * de la rotación un potrero que rindió poco porque le tocó la seca, no porque sea malo. Esa
 * decisión se paga varios años. Por eso `water` y `caveat` viajan pegados al número y no en otra
 * pantalla: un kg/ha sin su contexto hídrico invita a leerlo como una condena del potrero.
 *
 * Puro, sin IO.
 */

export type WaterContext = 'deficit' | 'normal' | 'excedente';
export type PerformanceConfidence = 'sin_datos' | 'baja' | 'media' | 'alta';

/** Un pastoreo cerrado: el lote entró, estuvo, salió. */
export interface GrazingWindow {
  /** Días entre entrada y salida. */
  grazingDays: number | null;
  /**
   * Kilos ganados DENTRO de la ventana, ya sumados sobre los animales medidos.
   *
   * Tiene que venir de pesajes que ocurrieron los dos dentro del pastoreo. Usar el pesaje anterior
   * del animal —que pudo ser en otro potrero— le atribuiría a éste kilos que engordó en otro lado,
   * que es exactamente la mentira que arruinaría la comparación.
   */
  gainKg: number | null;
  /** Animales con al menos dos pesajes dentro de la ventana. */
  animalsMeasured: number;
}

export interface PaddockPerformanceInput {
  areaHa: number | null;
  /** Pastoreos CERRADOS del período. Uno abierto todavía no tiene días ni ganancia. */
  windows: GrazingWindow[];
  /** Días del período analizado; normaliza el balance hídrico. */
  periodDays: number;
  /** Balance hídrico acumulado del período (lluvia − ETP), en mm. */
  waterBalanceMm: number | null;
  rainMm: number | null;
  /** Días con estrés calórico moderado o peor DENTRO de las ventanas de este potrero. */
  heatStressDays?: number;
}

export interface PaddockPerformanceOptions {
  /**
   * Umbral en mm/día para llamar déficit o excedente. Es una CONVENCIÓN de lectura, no una ley:
   * se normaliza por día porque «−60 mm» significa cosas distintas en dos semanas que en un año.
   */
  waterThresholdMmPerDay?: number;
}

export interface PaddockPerformance {
  /** Días de ocupación acumulados en el período. */
  grazingDays: number;
  gainKg: number | null;
  gainKgPerHa: number | null;
  /** Lo comparable entre potreros de distinto tamaño y distinta ocupación. */
  gainKgPerHaPerDay: number | null;
  animalsMeasured: number;
  confidence: PerformanceConfidence;
  water: WaterContext | null;
  /** El aviso que evita sacar de la rotación un potrero que solo tuvo mala suerte con el clima. */
  caveat: string | null;
  /**
   * Qué clase de aviso es. Existe porque no todos se leen igual: el estrés calórico afecta por
   * igual a todo lo pastoreado en las mismas fechas, así que repetirlo fila por fila contradice lo
   * que el propio texto dice. Con esto la pantalla puede mostrarlo UNA vez, como nota del período.
   */
  caveatKind: CaveatKind | null;
}

export type CaveatKind = 'sin_datos' | 'deficit' | 'estres' | 'pocos_animales';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * Confianza según cuántos animales sostienen el número.
 *
 * Mismos cortes que la evaluación de toros, y a propósito: dos pantallas del sistema que dicen
 * «confianza baja» tienen que querer decir lo mismo, o la palabra deja de significar algo.
 */
export function performanceConfidence(animalsMeasured: number): PerformanceConfidence {
  if (animalsMeasured <= 0) return 'sin_datos';
  if (animalsMeasured < 10) return 'baja';
  if (animalsMeasured < 30) return 'media';
  return 'alta';
}

/** Clasifica el balance hídrico del período. `null` si no se midió: no se supone «normal». */
export function classifyWater(waterBalanceMm: number | null | undefined, periodDays: number, thresholdMmPerDay = 1): WaterContext | null {
  // `Number(null)` es 0, que es finito: sin este corte, «no se midió» se leería como «llovió lo
  // justo» y el aviso que evita condenar al potrero no aparecería nunca.
  if (waterBalanceMm == null) return null;
  const mm = Number(waterBalanceMm);
  if (!Number.isFinite(mm) || !Number.isFinite(periodDays) || periodDays <= 0) return null;
  const porDia = mm / periodDays;
  if (porDia < -thresholdMmPerDay) return 'deficit';
  if (porDia > thresholdMmPerDay) return 'excedente';
  return 'normal';
}

export function computePaddockPerformance(input: PaddockPerformanceInput, opts: PaddockPerformanceOptions = {}): PaddockPerformance {
  const cerrados = input.windows.filter((w) => Number.isFinite(Number(w.grazingDays)) && Number(w.grazingDays) > 0);
  const grazingDays = cerrados.reduce((s, w) => s + Number(w.grazingDays), 0);
  const animalsMeasured = input.windows.reduce((s, w) => s + Math.max(0, Number(w.animalsMeasured) || 0), 0);

  // Se suman solo las ventanas que MIDIERON. Un pastoreo sin pesajes no es un pastoreo con
  // ganancia cero: tratarlo así hundiría el promedio del potrero por no haber pasado la balanza.
  const conGanancia = input.windows.filter((w) => w.gainKg != null && Number.isFinite(Number(w.gainKg)) && Number(w.animalsMeasured) > 0);
  const gainKg = conGanancia.length > 0 ? round2(conGanancia.reduce((s, w) => s + Number(w.gainKg), 0)) : null;

  const area = Number(input.areaHa);
  const areaValida = Number.isFinite(area) && area > 0;
  const gainKgPerHa = gainKg == null || !areaValida ? null : round2(gainKg / area);
  // Días de ocupación de las ventanas que aportaron kilos: dividir por los días de un pastoreo que
  // no se midió repartiría la ganancia sobre tiempo en el que nadie sabe qué pasó.
  const diasMedidos = conGanancia.reduce((s, w) => s + Math.max(0, Number(w.grazingDays) || 0), 0);
  const gainKgPerHaPerDay = gainKgPerHa == null || diasMedidos <= 0 ? null : round3(gainKgPerHa / diasMedidos);

  const water = classifyWater(input.waterBalanceMm, input.periodDays, opts.waterThresholdMmPerDay);
  const confidence = performanceConfidence(animalsMeasured);

  const aviso = buildCaveat(confidence, water, input);
  return { grazingDays, gainKg, gainKgPerHa, gainKgPerHaPerDay, animalsMeasured, confidence, water, caveat: aviso?.text ?? null, caveatKind: aviso?.kind ?? null };
}

/**
 * El aviso, en el idioma del productor. Es lo más importante que devuelve la función: el número
 * solo no alcanza para decidir, y una tabla de kg/ha sin esta línea se lee como un ranking de
 * potreros buenos y malos.
 */
function buildCaveat(confidence: PerformanceConfidence, water: WaterContext | null, input: PaddockPerformanceInput): { text: string; kind: CaveatKind } | null {
  if (confidence === 'sin_datos')
    return { kind: 'sin_datos', text: 'Sin pesajes dentro del pastoreo: no hay kilos que atribuir a este potrero. Pesar a la entrada y a la salida es lo que lo hace comparable.' };
  if (water === 'deficit')
    return { kind: 'deficit', text: 'El período tuvo déficit hídrico. Si rindió poco, puede ser la seca y no el potrero — conviene compararlo contra otros del MISMO período, nunca contra su propio año pasado.' };
  // Proporción y no un número absoluto: 15 días de estrés en un año son normales en el trópico y
  // 15 en tres semanas no. Con un umbral fijo el aviso salía en casi todas las filas, y un aviso
  // que aparece siempre no distingue nada — entrena a saltearlo.
  const estres = input.heatStressDays ?? 0;
  if (input.periodDays > 0 && estres / input.periodDays >= 0.5)
    return {
      kind: 'estres',
      text: `${estres} de ${input.periodDays} días con estrés calórico: los animales comen menos y ganan menos. Afecta a TODOS los potreros pastoreados en las mismas fechas, así que explica el nivel general del período, no por qué este potrero rindió distinto que otro.`,
    };
  if (confidence === 'baja') return { kind: 'pocos_animales', text: 'Pocos animales medidos: el número da una idea, no una conclusión.' };
  return null;
}
