import { parse } from 'csv-parse/sync';

/**
 * Parseo de CSV para el importador (P2). CSV UTF-8, con el separador DETECTADO
 * (ver `detectarSeparador`), campos entrecomillados. El contenido se
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

/** Separadores que aparecen en la vida real, en orden de preferencia ante un empate. */
const SEPARADORES = [',', ';', '\t', '|'] as const;

/**
 * Con qué carácter está separado este archivo.
 *
 * **Por qué no alcanza la coma.** Excel configurado en español guarda CSV con punto y coma —porque
 * la coma es el separador decimal— y eso es lo que sale de «Guardar como» en cualquier máquina de
 * Venezuela, Argentina o España. Con el separador fijo en coma, ese archivo se leía como UNA sola
 * columna: el encabezado entero en una celda. La importación moría ahí, y el mensaje que recibía el
 * productor era «faltan campos obligatorios en el mapping», que culpa al mapeo en vez de decir que
 * no se pudieron separar las columnas.
 *
 * **Cómo se decide.** Se cuenta cada candidato en la línea de encabezados, IGNORANDO lo que esté
 * entre comillas: un encabezado como `"Apellido, Nombre";Sexo` tiene una coma que no separa nada, y
 * contarla elegiría mal. Gana el más frecuente; si ninguno aparece, la coma — un archivo de una sola
 * columna es válido y no hay nada que detectar.
 */
export function detectarSeparador(primeraLinea: string): string {
  const conteo = new Map<string, number>(SEPARADORES.map((s) => [s, 0]));
  let entreComillas = false;
  for (let i = 0; i < primeraLinea.length; i++) {
    const c = primeraLinea[i];
    if (c === '"') {
      // Comilla doble escapada dentro de un campo entrecomillado: no abre ni cierra.
      if (entreComillas && primeraLinea[i + 1] === '"') i++;
      else entreComillas = !entreComillas;
      continue;
    }
    if (!entreComillas && conteo.has(c)) conteo.set(c, conteo.get(c)! + 1);
  }
  let mejor = ',';
  let max = 0;
  for (const s of SEPARADORES) {
    const n = conteo.get(s)!;
    if (n > max) {
      max = n;
      mejor = s;
    }
  }
  return mejor;
}

export function parseCsv(input: string): ParsedCsv {
  let records: string[][];
  try {
    records = parse(input, {
      bom: true, // descarta el BOM UTF-8 si está presente
      // El separador sale del archivo, no de una suposición. Se mira la primera línea sin el BOM,
      // que si no cuenta como parte del primer encabezado.
      delimiter: detectarSeparador(input.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''),
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
