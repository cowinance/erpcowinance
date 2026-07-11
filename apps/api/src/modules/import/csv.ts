import { parse } from 'csv-parse/sync';

/**
 * Parseo de CSV para el importador (P2). Alcance inicial: CSV UTF-8, coma,
 * campos entrecomillados (comas y saltos de línea embebidos). El contenido se
 * valida MEDIANTE el parser (no por MIME): un archivo no-CSV o sin encabezados
 * lanza `CsvParseError`. La normalización de valores (recorte, formatos) NO se
 * hace acá — es responsabilidad de los VOs de dominio (Herd) aguas abajo; este
 * parser preserva los valores tal cual.
 */

export interface ParsedCsv {
  headers: string[];
  /** Una fila por registro de datos: encabezado → valor (string, sin normalizar). */
  rows: Record<string, string>[];
}

export class CsvParseError extends Error {
  readonly code = 'import.csv_parse_error';
  constructor(reason: string) {
    super(`CSV inválido: ${reason}`);
    this.name = 'CsvParseError';
  }
}

export function parseCsv(input: string): ParsedCsv {
  let headers: string[] = [];
  let rows: Record<string, string>[];
  try {
    rows = parse(input, {
      bom: true, // descarta el BOM UTF-8 si está presente
      skip_empty_lines: true,
      relax_column_count: true, // tolera filas con más/menos columnas que el encabezado
      columns: (hdr: string[]) => {
        headers = hdr.map((h) => h.trim());
        return headers;
      },
    });
  } catch (e) {
    throw new CsvParseError((e as Error).message);
  }
  if (!headers.length || headers.every((h) => h === '')) {
    throw new CsvParseError('sin encabezados');
  }
  return { headers, rows };
}
