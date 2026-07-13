/**
 * Totales de un documento comercial (compra o venta) — REGLA ÚNICA derivada desde las líneas.
 * El servidor nunca acepta los totales del cliente: los calcula acá. `tax_rate` es una FRACCIÓN
 * (0.21 = 21%). Todo el dinero se redondea a 2 decimales.
 */
export interface DocumentLineInput {
  quantity: number;
  unit_price: number;
  /** Alícuota como fracción (0.21 = 21%). Ausente = 0. */
  tax_rate?: number;
}

export interface DocumentLineTotals {
  line_total: number;
  tax_amount: number;
}

export interface DocumentTotals {
  subtotal: number;
  tax_total: number;
  total: number;
  lines: DocumentLineTotals[];
}

/** Redondeo a 2 decimales estable (evita el sesgo de coma flotante en .005). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeDocumentTotals(lines: DocumentLineInput[]): DocumentTotals {
  const computed: DocumentLineTotals[] = lines.map((l) => {
    const lineTotal = round2(l.quantity * l.unit_price);
    const taxAmount = round2(lineTotal * (l.tax_rate ?? 0));
    return { line_total: lineTotal, tax_amount: taxAmount };
  });
  const subtotal = round2(computed.reduce((s, l) => s + l.line_total, 0));
  const taxTotal = round2(computed.reduce((s, l) => s + l.tax_amount, 0));
  return { subtotal, tax_total: taxTotal, total: round2(subtotal + taxTotal), lines: computed };
}
