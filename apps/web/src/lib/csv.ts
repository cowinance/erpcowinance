/**
 * CSV robusto para exportar reportes (P9-3). Único lugar que serializa/descarga CSV en la web.
 *
 * Endurecido contra:
 *  - Inyección de fórmulas (Excel/Sheets): una celda que empieza con `= + - @` (o TAB/CR) se
 *    ejecutaría como fórmula. Se neutraliza prefijando un apóstrofo.
 *  - Comillas/comas/saltos de línea: se entrecomilla y se duplican las comillas internas.
 *  - BOM UTF-8 para que Excel respete acentos.
 */

const NEEDS_QUOTE = /[",\n\r]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  // Un NÚMERO nunca es una fórmula: la inyección viaja en texto. Escaparlo rompería el export sin
  // ganar seguridad — un importe negativo (`-7331.57`) quedaría como `'-7331.57`, o sea TEXTO en
  // Excel, y la columna dejaría de poder sumarse. Los reportes de costos son casi todos negativos.
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const raw = String(v);
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw; // neutraliza inyección de fórmulas
  return NEEDS_QUOTE.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

/** Serializa `rows` a CSV (con BOM) y dispara la descarga en el navegador. */
export function downloadCsv(name: string, rows: (string | number | null)[][]): void {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
