/**
 * Totales de una liquidación de sueldos (H-2). `net = gross − deductions` por ítem. Los totales
 * alimentan el asiento de nómina (D sueldos = Σgross; H a pagar = Σnet; H retenciones = Σdeductions),
 * balanceado por construcción (Σgross = Σnet + Σdeductions). Montos a 2 decimales.
 */
export interface PayrollItemInput {
  gross: number;
  deductions?: number;
}

export class InvalidPayrollError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidPayrollError';
  }
}

export interface PayrollTotals {
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  nets: number[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Valida los ítems (gross ≥ 0, 0 ≤ deductions ≤ gross) y devuelve los totales + el neto por ítem. */
export function computePayrollTotals(items: PayrollItemInput[]): PayrollTotals {
  if (!Array.isArray(items) || items.length === 0) throw new InvalidPayrollError('La liquidación necesita al menos un ítem');
  let totalGross = 0;
  let totalDeductions = 0;
  const nets: number[] = [];
  for (const it of items) {
    const gross = round2(Number(it.gross));
    const deductions = round2(Number(it.deductions ?? 0));
    if (!Number.isFinite(gross) || gross < 0) throw new InvalidPayrollError('gross debe ser ≥ 0');
    if (!Number.isFinite(deductions) || deductions < 0) throw new InvalidPayrollError('deductions debe ser ≥ 0');
    if (deductions > gross) throw new InvalidPayrollError('deductions no puede superar gross');
    const net = round2(gross - deductions);
    nets.push(net);
    totalGross = round2(totalGross + gross);
    totalDeductions = round2(totalDeductions + deductions);
  }
  const totalNet = round2(totalGross - totalDeductions);
  if (totalGross === 0) throw new InvalidPayrollError('La liquidación no puede ser por cero');
  return { totalGross, totalDeductions, totalNet, nets };
}
