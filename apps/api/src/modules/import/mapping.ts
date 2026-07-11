import { ANIMAL_IMPORT_DESCRIPTOR, AnimalImportField } from '../herd/animal-import-descriptor';

/**
 * Mapping sugerido de columnas (P2 oleada 3.3a). Puro: dado el conjunto de
 * encabezados de origen, sugiere qué encabezado corresponde a cada campo
 * canónico del `AnimalImportDescriptor`. NO inventa mappings: solo incluye los
 * campos cuyo(s) sinónimo(s) coinciden con algún encabezado (resultado PARCIAL).
 * La obligatoriedad de tag/sex/category_code se valida en 3.4, no acá.
 */

export class DuplicateHeadersError extends Error {
  readonly code = 'import.duplicate_headers';
  constructor(
    readonly normalized: string,
    readonly headers: string[],
  ) {
    super(`Encabezados duplicados tras normalizar (${headers.join(', ')} → '${normalized}')`);
    this.name = 'DuplicateHeadersError';
  }
}

/**
 * Normaliza un encabezado para el matching contra los sinónimos del descriptor
 * (que ya vienen normalizados): minúsculas, sin acentos, sin espacios en los
 * bordes y con espacios internos colapsados. Preserva guiones bajos.
 */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remueve marcas diacríticas combinantes (á→a, ñ→n)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Sugerencia de mapping campo canónico → encabezado ORIGINAL (parcial).
 * - Rechaza encabezados que colisionan tras normalizar (ambiguo → no determinista).
 * - Para cada campo, gana el PRIMER encabezado (en orden de aparición) cuyo
 *   normalizado sea sinónimo del campo (determinista).
 * - Un encabezado sin sinónimo no aporta ningún mapping (sin invención).
 */
export function suggestMapping(headers: string[]): Partial<Record<AnimalImportField, string>> {
  // Rechazo de encabezados duplicados tras normalizar.
  const byNorm = new Map<string, string[]>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    const group = byNorm.get(n);
    if (group) group.push(h);
    else byNorm.set(n, [h]);
  }
  for (const [n, group] of byNorm) {
    if (group.length > 1) throw new DuplicateHeadersError(n, group);
  }

  const result: Partial<Record<AnimalImportField, string>> = {};
  for (const field of ANIMAL_IMPORT_DESCRIPTOR.fields) {
    const synonyms = new Set(field.synonyms);
    const match = headers.find((h) => synonyms.has(normalizeHeader(h)));
    if (match !== undefined) result[field.field] = match;
  }
  return result;
}
