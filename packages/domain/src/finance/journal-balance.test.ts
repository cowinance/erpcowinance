import { describe, expect, it } from 'vitest';
import { validateJournalBalance, UnbalancedJournalError } from './journal-balance';

const A = 'a', B = 'b';

describe('validateJournalBalance', () => {
  it('acepta un asiento balanceado y devuelve los totales', () => {
    const r = validateJournalBalance([
      { account_id: A, debit: 121 },
      { account_id: B, credit: 121 },
    ]);
    expect(r).toEqual({ totalDebit: 121, totalCredit: 121 });
  });

  it('acepta múltiples líneas balanceadas (venta con IVA)', () => {
    const r = validateJournalBalance([
      { account_id: 'clientes', debit: 121 },
      { account_id: 'ventas', credit: 100 },
      { account_id: 'iva_debito', credit: 21 },
    ]);
    expect(r.totalDebit).toBe(121);
    expect(r.totalCredit).toBe(121);
  });

  it('rechaza si no balancea', () => {
    expect(() => validateJournalBalance([{ account_id: A, debit: 100 }, { account_id: B, credit: 90 }])).toThrow(UnbalancedJournalError);
  });

  it('rechaza menos de 2 líneas', () => {
    expect(() => validateJournalBalance([{ account_id: A, debit: 100 }])).toThrow(UnbalancedJournalError);
  });

  it('rechaza una línea con débito Y crédito, o ninguno', () => {
    expect(() => validateJournalBalance([{ account_id: A, debit: 50, credit: 50 }, { account_id: B, credit: 50 }])).toThrow(UnbalancedJournalError);
    expect(() => validateJournalBalance([{ account_id: A, debit: 0, credit: 0 }, { account_id: B, credit: 50 }])).toThrow(UnbalancedJournalError);
  });

  it('rechaza montos negativos y el asiento por cero', () => {
    expect(() => validateJournalBalance([{ account_id: A, debit: -10 }, { account_id: B, credit: -10 }])).toThrow(UnbalancedJournalError);
    expect(() => validateJournalBalance([{ account_id: A, debit: 0 }, { account_id: B, credit: 0 }])).toThrow(UnbalancedJournalError);
  });
});
