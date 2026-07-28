import { API_URL, authHeaders } from './api';

/** Un toro candidato, con la consanguinidad que tendría la cría de ese apareamiento. */
export interface MatingCandidate {
  sire_id: string;
  sire_name: string;
  tag: string | null;
  f: number;
  f_pct: number;
  level: 'none' | 'low' | 'moderate' | 'high';
  blocks: boolean;
}

/**
 * Los toros de la finca ordenados por cuán poco emparentados están con esta vaca.
 *
 * Una sola llamada trae TODOS los candidatos con su coeficiente: preguntar de a un toro serían
 * tantas consultas como toros tenga la finca, y en la manga eso es tiempo con el animal encerrado.
 *
 * Devuelve `null` si no se pudo consultar, y quien lo llama sigue andando sin el dato. En el corral
 * puede no haber señal, y una pantalla de captura que se rompe porque falló una consulta de apoyo
 * es peor que una que no muestra la sugerencia.
 */
export async function fetchMatingCandidates(damId: string): Promise<MatingCandidate[] | null> {
  try {
    const res = await fetch(`${API_URL}/genetics/inbreeding/advisor/${damId}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const body = await res.json();
    return (body?.sires ?? []) as MatingCandidate[];
  } catch {
    return null;
  }
}

/** Cómo se pinta cada nivel. Mismo criterio en la ficha y en la manga. */
export const MATING_TONE: Record<MatingCandidate['level'], string> = {
  none: 'text-success',
  low: 'text-success',
  moderate: 'text-warning',
  high: 'text-danger',
};

export const MATING_LABEL: Record<MatingCandidate['level'], string> = {
  none: 'sin parentesco',
  low: 'parentesco lejano',
  moderate: 'parentesco moderado',
  high: 'no conviene',
};
