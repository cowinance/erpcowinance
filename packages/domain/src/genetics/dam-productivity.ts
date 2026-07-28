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

/** Lo que la finca sabe de una vaca: cuándo empezó a producir y qué destetó. */
export interface DamRecord {
  readonly damId: string;
  /** Primer parto (`YYYY-MM-DD`). Desde acá se cuenta: antes no era un vientre en producción. */
  readonly firstCalvingDate: string;
  /** Los destetes que se le atribuyen, con el peso real. */
  readonly weanings: readonly { readonly date: string; readonly kg: number }[];
  /** Si ya no está (vendida, muerta, descartada): hasta acá se la cuenta. */
  readonly exitDate?: string | null;
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

      return {
        damId: r.damId,
        calves: validos.length,
        totalWeanedKg: round1(total),
        years: round1(years),
        kgPerYear: round1(total / years),
        avgWeaningKg: validos.length ? round1(total / validos.length) : 0,
        lastWeaningDate: fechas.length ? fechas[fechas.length - 1] : null,
        confidence: damConfidenceFor(validos.length),
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
  const evaluables = dams.filter((d) => d.confidence !== 'baja');
  if (evaluables.length < 3) return [];

  const ordenados = [...evaluables].map((d) => d.kgPerYear).sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  const mediana = ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
  const corte = mediana * (1 - pctBajoMediana / 100);

  return evaluables.filter((d) => d.kgPerYear < corte).sort((a, b) => a.kgPerYear - b.kgPerYear);
}
