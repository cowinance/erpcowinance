import { parse } from 'csv-parse/sync';

/**
 * Parseo de CSV para el importador (P2). Alcance inicial: CSV UTF-8, coma,
 * campos entrecomillados (comas y saltos de línea embebidos). El contenido se
 * valida MEDIANTE el parser (no por MIME): un archivo no-CSV o sin encabezados
 * lanza `CsvParseError`. La normalización de valores (recorte, formatos) NO se
 * hace acá — es responsabilidad de los VOs de dominio (Herd) aguas abajo; este
 * parser preserva los valores tal cual.
 *
 * Filas irregulares (P2 3.3b): NINGÚN valor se pierde en silencio.
 *  - Fila con MÁS columnas que el encabezado → `CsvIrregularRowError` (con nº de fila).
 *  - Fila con MENOS columnas → se conserva con los campos faltantes ausentes.
 * Por eso se parsea en modo arrays (para conocer la longitud real de cada fila).
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

export class CsvIrregularRowError extends Error {
  readonly code = 'import.irregular_row';
  constructor(
    readonly rowNumber: number,
    readonly got: number,
    readonly expected: number,
  ) {
    super(`Fila ${rowNumber}: ${got} columnas, más que el encabezado (${expected})`);
    this.name = 'CsvIrregularRowError';
  }
}

export function parseCsv(input: string): ParsedCsv {
  let records: string[][];
  try {
    records = parse(input, {
      bom: true, // descarta el BOM UTF-8 si está presente
      skip_empty_lines: true,
      relax_column_count: true, // no aborta por conteo: devuelve la longitud real de cada fila
      columns: false, // modo arrays: necesitamos la longitud real por fila
    });
  } catch (e) {
    throw new CsvParseError((e as Error).message);
  }
  if (!records.length) throw new CsvParseError('sin encabezados');

  const headers = records[0].map((h) => h.trim());
  if (!headers.length || headers.every((h) => h === '')) throw new CsvParseError('sin encabezados');

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    // Más columnas que el encabezado → no truncar en silencio: fallar con el nº de fila.
    if (cells.length > headers.length) {
      throw new CsvIrregularRowError(i, cells.length, headers.length); // i = nº de fila de datos (1-based)
    }
    // Menos columnas → conservar la fila; los headers sin celda quedan ausentes.
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      if (c < cells.length) row[headers[c]] = cells[c];
    }
    rows.push(row);
  }
  return { headers, rows };
}
