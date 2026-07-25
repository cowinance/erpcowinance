/**
 * Numeración fiscal (Venezuela, G4-2) — formato y agotamiento del lote. Reglas puras.
 *
 * Un comprobante venezolano lleva DOS números, y no son variantes del mismo:
 *
 *   · **Número de documento** — el correlativo del emisor, uno por tipo de comprobante. La factura
 *     001234 y la nota de crédito 000045 conviven sin pisarse.
 *   · **Número de control** — viene del LOTE de formas libres que autorizó la imprenta. Es único
 *     sobre TODOS los tipos, porque identifica el papel, no el documento: dos comprobantes
 *     distintos impresos en la misma forma serían el mismo control.
 *
 * Esa diferencia —uno por tipo, el otro global— es la razón de que sean dos series y no una con dos
 * columnas. Ninguno admite huecos.
 *
 * Acá vive solo lo que se puede decidir SIN base: cómo se escribe un número y cuánto queda del
 * lote. La ASIGNACIÓN necesita bloqueo transaccional y vive en la API.
 */

/** Tipos de comprobante que llevan correlativo propio. */
export const FISCAL_DOCUMENT_TYPES = ['invoice', 'credit_note', 'debit_note', 'delivery_note'] as const;
export type FiscalDocumentType = (typeof FISCAL_DOCUMENT_TYPES)[number];

export const FISCAL_DOCUMENT_TYPE_LABEL: Record<FiscalDocumentType, string> = {
  invoice: 'Factura',
  credit_note: 'Nota de crédito',
  debit_note: 'Nota de débito',
  delivery_note: 'Nota de entrega',
};

/** Qué numera una serie: el correlativo del emisor o el del lote de la imprenta. */
export const SERIES_PURPOSES = ['document', 'control'] as const;
export type SeriesPurpose = (typeof SERIES_PURPOSES)[number];

export const DEFAULT_PADDING = 8;

export class InvalidSeriesError extends Error {
  constructor(
    readonly problem: 'bad_prefix' | 'bad_padding' | 'bad_range' | 'bad_start',
    message: string,
  ) {
    super(message);
    this.name = 'InvalidSeriesError';
  }
}

/**
 * Escribe el número con los ceros a la izquierda y el prefijo. Los ceros NO son decoración: el
 * comprobante se imprime con un ancho fijo, y `00-00000123` y `00-123` serían el mismo número
 * escrito de dos formas — que es exactamente lo que rompe un correlativo cuando alguien lo busca.
 */
export function formatFiscalNumber(prefix: string | null | undefined, n: number, padding = DEFAULT_PADDING): string {
  const cuerpo = String(Math.trunc(n)).padStart(padding, '0');
  const p = (prefix ?? '').trim();
  return p ? `${p}-${cuerpo}` : cuerpo;
}

export type SeriesHealth = 'ok' | 'low' | 'exhausted';

export interface SeriesStatus {
  /** Cuántos comprobantes quedan por emitir. `null` si la serie no tiene tope (correlativo propio). */
  remaining: number | null;
  health: SeriesHealth;
  /** El siguiente número que se va a entregar, ya formateado. `null` si no queda ninguno. */
  nextFormatted: string | null;
}

/**
 * Cuánto queda del lote autorizado. Existe para avisar ANTES: quedarse sin formas libres no es un
 * inconveniente administrativo, es no poder facturar hasta que la imprenta entregue el lote nuevo,
 * y eso tarda. El umbral por defecto son 50 comprobantes, que a ritmo de finca da semanas de aviso.
 *
 * Sin tope (`rangeTo` nulo) la serie es el correlativo propio del emisor, que no se agota: no hay
 * nada que avisar y `remaining` es `null` — que NO es cero.
 */
export function seriesStatus(
  next: number,
  rangeTo: number | null | undefined,
  prefix?: string | null,
  padding = DEFAULT_PADDING,
  lowThreshold = 50,
): SeriesStatus {
  if (rangeTo === null || rangeTo === undefined)
    return { remaining: null, health: 'ok', nextFormatted: formatFiscalNumber(prefix, next, padding) };

  const remaining = Math.max(0, rangeTo - next + 1);
  const health: SeriesHealth = remaining === 0 ? 'exhausted' : remaining <= lowThreshold ? 'low' : 'ok';
  return { remaining, health, nextFormatted: remaining === 0 ? null : formatFiscalNumber(prefix, next, padding) };
}

/**
 * Valida la definición de una serie antes de guardarla. Es barato acá y carísimo después: una serie
 * mal definida no falla al crearse, falla al emitir el comprobante número mil.
 */
export function validateSeries(input: {
  prefix?: string | null;
  padding?: number | null;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  next: number;
}): void {
  const prefix = (input.prefix ?? '').trim();
  // El prefijo va impreso: dígitos y letras, corto. Un guion adentro daría `00-01-00000123`.
  if (prefix && !/^[0-9A-Z]{1,4}$/i.test(prefix))
    throw new InvalidSeriesError('bad_prefix', 'El prefijo admite hasta 4 letras o dígitos, sin guiones ni espacios');

  const padding = input.padding ?? DEFAULT_PADDING;
  if (!Number.isInteger(padding) || padding < 1 || padding > 12)
    throw new InvalidSeriesError('bad_padding', 'La cantidad de dígitos debe estar entre 1 y 12');

  const { rangeFrom, rangeTo } = input;
  if (rangeFrom != null && rangeTo != null && rangeTo < rangeFrom)
    throw new InvalidSeriesError('bad_range', 'El fin del lote no puede ser menor que el inicio');

  if (!Number.isInteger(input.next) || input.next < 1)
    throw new InvalidSeriesError('bad_start', 'El próximo número debe ser un entero positivo');

  // Empezar el correlativo fuera del lote autorizado emitiría con un control que la imprenta nunca
  // imprimió. Se atrapa acá, no cuando el comprobante ya salió.
  if (rangeFrom != null && input.next < rangeFrom)
    throw new InvalidSeriesError('bad_start', 'El próximo número está por debajo del inicio del lote autorizado');
  if (rangeTo != null && input.next > rangeTo + 1)
    throw new InvalidSeriesError('bad_start', 'El próximo número está por encima del fin del lote autorizado');
}
