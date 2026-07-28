/**
 * El índice de un toro a lo largo de su carrera, no de una temporada.
 *
 * **El problema.** La evaluación se hacía de a un año: el índice de cada toro dentro del grupo
 * contemporáneo de esa parición. Correcto, pero incompleto — un toro usado tres temporadas quedaba
 * con tres índices sueltos que nadie sumaba. Con 8 terneros por año la confianza es «baja» las tres
 * veces; con los 24 juntos es «media», y eso ya es otra decisión de compra.
 *
 * **Por qué no se juntan los terneros y listo.** Porque los pesos de años distintos NO son
 * comparables: un año seco baja a todos, y promediar entre años le atribuiría a la genética lo que
 * fue la lluvia. Es exactamente lo que el grupo contemporáneo viene a evitar.
 *
 * Lo que sí se puede juntar son los ÍNDICES, que ya vienen normalizados contra el promedio de su
 * propio grupo: un 108 de 2024 y un 108 de 2026 significan lo mismo —8% por encima de sus
 * contemporáneos— aunque los kilos crudos no tengan nada que ver. Se combinan ponderando por
 * cantidad de terneros, para que una temporada con dos crías no pese igual que una con veinte.
 *
 * Puro, sin IO.
 */

import { confidenceFor, type SireIndex } from './weaning-weight';

/** Un grupo contemporáneo ya evaluado: el año y el índice de cada toro dentro de él. */
export interface ContemporaryGroupResult {
  readonly year: number;
  readonly indexes: readonly SireIndex[];
}

export interface SireCareer {
  readonly sireId: string;
  /** Terneros evaluados sumando todas las temporadas. */
  readonly n: number;
  /** Índice combinado, ponderado por cuántos terneros aportó cada temporada. */
  readonly index: number;
  /** Confianza según el TOTAL de terneros: es lo que gana mirar la carrera y no una temporada. */
  readonly confidence: SireIndex['confidence'];
  /** Las temporadas en que se usó, de la más reciente a la más vieja. */
  readonly years: readonly number[];
  /** El índice de cada temporada, para ver si viene mejorando o si un año lo salvó. */
  readonly by_year: readonly { readonly year: number; readonly n: number; readonly index: number }[];
}

/**
 * Combina los índices de un toro entre temporadas.
 *
 * El orden de salida es por índice combinado, igual que la evaluación de una temporada, para que
 * las dos pantallas se lean igual.
 */
export function sireCareers(groups: readonly ContemporaryGroupResult[]): SireCareer[] {
  const porToro = new Map<string, { year: number; n: number; index: number }[]>();

  for (const g of groups)
    for (const idx of g.indexes) {
      const arr = porToro.get(idx.sireId) ?? [];
      arr.push({ year: g.year, n: idx.n, index: idx.index });
      porToro.set(idx.sireId, arr);
    }

  return [...porToro.entries()]
    .map(([sireId, temporadas]) => {
      const n = temporadas.reduce((s, t) => s + t.n, 0);
      // Ponderado por terneros: una temporada de 2 crías no puede pesar igual que una de 20.
      const index = n > 0 ? Math.round(temporadas.reduce((s, t) => s + t.index * t.n, 0) / n) : 0;
      const porAnio = [...temporadas].sort((a, b) => b.year - a.year);
      return {
        sireId,
        n,
        index,
        confidence: confidenceFor(n),
        years: porAnio.map((t) => t.year),
        by_year: porAnio,
      };
    })
    .sort((a, b) => b.index - a.index);
}
