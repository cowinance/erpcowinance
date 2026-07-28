/**
 * Kilos de ternero destetados por vaca y por año: con qué vientres quedarse.
 *
 * **Por qué faltaba.** La mitad de la genética de cada ternero viene de la madre, y hasta acá
 * ninguna vaca se evaluaba individualmente: `dam_id` solo aparecía como *ajuste* del peso al
 * destete, nunca como sujeto. Eso deja afuera la decisión más frecuente de una finca de cría —**qué
 * vientres retengo y cuáles se van**—, que hoy se toma a ojo o por lo que se acuerda el capataz.
 *
 * **Por qué ESTE número y no el peso al destete.** El peso de la cría dice cuánto crió, pero no dice
 * si crió TODOS los años. Una vaca que desteta 200 kg cada temporada y otra que desteta 220 kg pero
 * se saltea un año de cada tres producen 200 y 147 kg por año respectivamente: la segunda parece
 * mejor madre y es peor negocio. Repartir los kilos entre los años que lleva en el rodeo mete la
 * fertilidad, la leche y la genética en un solo número, que es como se decide una reposición.
 *
 * **Kilos reales, no ajustados.** Acá se cuenta lo que la vaca produjo de verdad, no lo que habría
 * producido a 205 días con una madre adulta. El ajuste existe para comparar TOROS quitándoles el
 * efecto de la madre; usarlo para juzgar a la madre le quitaría justamente lo que se le quiere
 * medir. El promedio ajustado va al lado como dato de apoyo, no como el número principal.
 *
 * Puro, sin IO ni relojes: la fecha de referencia entra como parámetro.
 */

import { impossibleCalvingIntervals } from '../reproduction/calving-interval';

/** Lo que la finca sabe de una vaca: cuándo empezó a producir y qué destetó. */
export interface DamRecord {
  readonly damId: string;
  /** Primer parto (`YYYY-MM-DD`). Desde acá se cuenta: antes no era un vientre en producción. */
  readonly firstCalvingDate: string;
  /** Los destetes que CRIÓ: los propios y los que gestó para otra. Es lo que produjo de verdad. */
  readonly weanings: readonly { readonly date: string; readonly kg: number }[];
  /**
   * Los destetes de crías que llevan SUS genes pero gestó otra vaca (ella fue donante).
   *
   * Van aparte porque contestan otra pregunta. Sumarlos a lo que crió le regalaría kilos que no
   * produjo; ignorarlos borraría el aporte de una donante, que puede tener media majada con su
   * genética y aun así destetar poco de su propio vientre.
   */
  readonly donatedWeanings?: readonly { readonly date: string; readonly kg: number }[];
  /** Si ya no está (vendida, muerta, descartada): hasta acá se la cuenta. */
  readonly exitDate?: string | null;
  /**
   * Todas sus fechas de parto, para poder detectar historiales imposibles.
   *
   * Una vaca con partos más cerca que una gestación tiene los kilos por año inflados, y ese número
   * no se arregla solo: hay que corregir las fechas. Mostrarlo como si fuera producción real haría
   * retener a la que tiene la carga mal y descartar a la buena.
   */
  readonly calvingDates?: readonly string[];
}

export interface DamProductivity {
  readonly damId: string;
  readonly calves: number;
  readonly totalWeanedKg: number;
  /** Años en producción, desde el primer parto. Nunca menos de 1. */
  readonly years: number;
  /** El número que ordena: kilos destetados por año en el rodeo. */
  readonly kgPerYear: number;
  readonly avgWeaningKg: number;
  readonly lastWeaningDate: string | null;
  readonly confidence: DamConfidence;
  /** Crías con sus genes gestadas por OTRA vaca. Cero en una finca que no hace transferencia. */
  readonly donatedCalves: number;
  /** Kilos destetados por año de esas crías. Mide su valor como DONANTE, no su producción. */
  readonly geneticKgPerYear: number;
  /** `true` si donó embriones: no se la juzga por lo que cría, porque no es lo que se le pide. */
  readonly isDonor: boolean;
  /**
   * Intervalos entre partos que son físicamente imposibles.
   *
   * Cuando hay alguno, `kgPerYear` está inflado y no se puede creer. Se informa en vez de
   * esconderse — es el mismo criterio que usa el resto del módulo con los destetes descartados.
   */
  readonly impossibleIntervals: number;
}

/**
 * Cuánto pesa el número.
 *
 * Los cortes NO son los de los toros. Un toro deja decenas de hijos por temporada y ahí 10 y 30
 * terneros son umbrales razonables; una vaca deja **uno por año**, así que pedirle diez sería
 * pedirle diez años y no quedaría ninguna vaca evaluable. Con dos destetes ya se distingue una
 * vaca regular de una que falla; con cuatro, la tendencia es firme.
 */
export type DamConfidence = 'baja' | 'media' | 'alta';

export function damConfidenceFor(calves: number): DamConfidence {
  if (calves < 2) return 'baja';
  if (calves < 4) return 'media';
  return 'alta';
}

const DIAS_POR_ANIO = 365.25;

/** Años entre dos fechas calendario. Sin husos: las dos son fechas, no instantes. */
function aniosEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return (b - a) / (DIAS_POR_ANIO * 86_400_000);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Productividad de cada vientre, ordenada de la que más produce a la que menos.
 *
 * El denominador corre hasta HOY (o hasta que la vaca salió del rodeo), no hasta su último destete.
 * Es a propósito y es lo que hace útil al número: una vaca que hace dos años que no desteta tiene
 * que caer en el ranking, porque está comiendo sin producir. Medir hasta su último destete la
 * dejaría congelada en su mejor momento, que es exactamente el error que se quiere evitar al
 * decidir una reposición.
 *
 * El piso de un año evita que una vaca de primer parto reciente aparezca arriba de todo por dividir
 * por una fracción: con tres meses en producción, 180 kg no son 720 kg al año.
 */
export function damProductivity(records: readonly DamRecord[], referenceDate: string): DamProductivity[] {
  return records
    .map((r) => {
      const validos = r.weanings.filter((w) => Number.isFinite(Number(w.kg)) && Number(w.kg) > 0);
      const total = validos.reduce((s, w) => s + Number(w.kg), 0);
      const hasta = r.exitDate ?? referenceDate;
      const years = Math.max(1, aniosEntre(r.firstCalvingDate, hasta));
      const fechas = validos.map((w) => w.date).sort();

      const imposibles = impossibleCalvingIntervals(r.calvingDates ?? []);
      const donados = (r.donatedWeanings ?? []).filter((w) => Number.isFinite(Number(w.kg)) && Number(w.kg) > 0);
      const totalDonado = donados.reduce((s, w) => s + Number(w.kg), 0);

      return {
        damId: r.damId,
        calves: validos.length,
        totalWeanedKg: round1(total),
        years: round1(years),
        kgPerYear: round1(total / years),
        avgWeaningKg: validos.length ? round1(total / validos.length) : 0,
        lastWeaningDate: fechas.length ? fechas[fechas.length - 1] : null,
        confidence: damConfidenceFor(validos.length),
        donatedCalves: donados.length,
        geneticKgPerYear: round1((total + totalDonado) / years),
        isDonor: donados.length > 0,
        impossibleIntervals: imposibles.length,
      };
    })
    .sort((a, b) => b.kgPerYear - a.kgPerYear);
}

/**
 * Las candidatas a descarte: las que están por debajo del rodeo.
 *
 * Se compara contra la MEDIANA y no contra el promedio: con pocas vacas, una excepcional arrastra
 * el promedio hacia arriba y de golpe media majada queda «por debajo». La mediana no se mueve por
 * un caso extremo, que es lo que hace falta cuando la decisión es sacar un animal.
 *
 * Las de confianza baja quedan afuera: descartar una vaca por su primer destete es apurarse.
 */
export function cullCandidates(dams: readonly DamProductivity[], pctBajoMediana = 25): DamProductivity[] {
  // A una DONANTE no se la juzga por lo que cría: su trabajo es dar embriones, y su propio vientre
  // puede estar descansando a propósito. Marcarla para descarte sería sacar del rodeo justamente a
  // la vaca cuya genética se está multiplicando.
  // Tampoco se juzga a una vaca con el historial mal cargado: sus kilos por año están inflados, así
  // que compararla contra el rodeo —para bien o para mal— es comparar contra un número que no es.
  const evaluables = dams.filter((d) => d.confidence !== 'baja' && !d.isDonor && d.impossibleIntervals === 0);
  if (evaluables.length < 3) return [];

  const ordenados = [...evaluables].map((d) => d.kgPerYear).sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  const mediana = ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
  const corte = mediana * (1 - pctBajoMediana / 100);

  return evaluables.filter((d) => d.kgPerYear < corte).sort((a, b) => a.kgPerYear - b.kgPerYear);
}
