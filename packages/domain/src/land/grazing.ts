/**
 * Métricas de un pastoreo (PG-1) — DERIVADAS, regla única. Un lote entra a un potrero (`entry`) y sale
 * (`exit`); se mide el forraje disponible antes (`pre`) y después (`post`), en kg de materia seca por
 * hectárea. Nada de esto se persiste: se calcula al leer.
 *
 * - `grazing_days`: días entre entrada y salida (null mientras el pastoreo está abierto).
 * - `forage_consumed_kg_dm_ha`: forraje consumido = pre − post (null si falta alguna medición).
 * - `is_open`: no tiene fecha de salida.
 */
export interface GrazingMetrics {
  grazing_days: number | null;
  forage_consumed_kg_dm_ha: number | null;
  is_open: boolean;
}

const MS_PER_DAY = 86_400_000;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function computeGrazingMetrics(
  entryDate: string,
  exitDate: string | null | undefined,
  preKgDmHa: number | null | undefined,
  postKgDmHa: number | null | undefined,
): GrazingMetrics {
  const isOpen = exitDate == null;
  let grazingDays: number | null = null;
  if (exitDate != null) {
    const days = Math.round((Date.parse(exitDate) - Date.parse(entryDate)) / MS_PER_DAY);
    grazingDays = Number.isFinite(days) ? days : null;
  }
  const forage = preKgDmHa != null && postKgDmHa != null ? round3(Number(preKgDmHa) - Number(postKgDmHa)) : null;
  return { grazing_days: grazingDays, forage_consumed_kg_dm_ha: forage, is_open: isOpen };
}
