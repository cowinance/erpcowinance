/**
 * Regla ÚNICA de un asiento de partida doble: debe BALANCEAR (Σdébito = Σcrédito), tener ≥2 líneas, y
 * cada línea debe cargar débito XOR crédito con un monto positivo. Validador puro, reutilizado por los
 * asientos manuales (F-1) y por los asientos automáticos desde documentos (F-2). Montos a 2 decimales.
 */
export interface JournalLineInput {
  account_id: string;
  debit?: number;
  credit?: number;
  cost_center_id?: string | null;
  description?: string | null;
}

export class UnbalancedJournalError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'UnbalancedJournalError';
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface JournalTotals {
  totalDebit: number;
  totalCredit: number;
}

/** Valida y normaliza las líneas; lanza UnbalancedJournalError si el asiento no es válido. */
export function validateJournalBalance(lines: JournalLineInput[]): JournalTotals {
  if (!Array.isArray(lines) || lines.length < 2) throw new UnbalancedJournalError('El asiento necesita al menos 2 líneas');
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    const debit = round2(Number(l.debit ?? 0));
    const credit = round2(Number(l.credit ?? 0));
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) throw new UnbalancedJournalError('Débito y crédito deben ser números ≥ 0');
    const hasDebit = debit > 0;
    const hasCredit = credit > 0;
    if (hasDebit === hasCredit) throw new UnbalancedJournalError('Cada línea debe tener débito XOR crédito (uno positivo, el otro 0)');
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
  }
  if (totalDebit !== totalCredit) throw new UnbalancedJournalError(`El asiento no balancea: débito ${totalDebit} ≠ crédito ${totalCredit}`);
  if (totalDebit === 0) throw new UnbalancedJournalError('El asiento no puede ser por cero');
  return { totalDebit, totalCredit };
}
