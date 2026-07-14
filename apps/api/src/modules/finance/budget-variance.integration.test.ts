import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { BudgetsService } from './budgets.service';

/**
 * Integración de presupuesto vs real (BG-2): el real sale de los asientos POSTEADOS del año fiscal y se
 * normaliza al sentido natural de la cuenta (deudora vs acreedora). `db.tenant` cae al demo.
 */
describe('finance — presupuesto vs real', () => {
  let db: DbService;
  let accounts: AccountsService;
  let ledger: LedgerService;
  let budgets: BudgetsService;
  let originalCwd: string;
  let tmp: string;
  let gastos: string;
  let ventas: string;
  let caja: string;
  let budgetId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'bgvar-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    accounts = new AccountsService(db);
    ledger = new LedgerService(db);
    budgets = new BudgetsService(db, accounts);

    gastos = ((await accounts.createAccount({ code: '5.1.10', name: 'Alimentación', type: 'expense' })) as any).id;
    ventas = ((await accounts.createAccount({ code: '4.1.01', name: 'Ventas', type: 'income' })) as any).id;
    caja = ((await accounts.createAccount({ code: '1.1.01', name: 'Caja', type: 'asset' })) as any).id;
    await accounts.createPeriod({ name: '2030', start_date: '2030-01-01', end_date: '2030-12-31' });
    await accounts.createPeriod({ name: '2031', start_date: '2031-01-01', end_date: '2031-12-31' });

    // Presupuesto 2030: gasto 1000 (enero), ingreso 5000 (enero).
    const b: any = await budgets.create({ name: 'Presupuesto 2030', fiscal_year: 2030 });
    budgetId = b.id;
    await budgets.setLines(budgetId, {
      lines: [
        { account_id: gastos, month: 1, amount: 1000 },
        { account_id: ventas, month: 1, amount: 5000 },
      ],
    });

    // Real 2030: gasté 1200 (D gasto / H caja) y facturé 4000 (D caja / H ventas).
    await ledger.createEntry({ entry_date: '2030-01-15', lines: [{ account_id: gastos, debit: 1200 }, { account_id: caja, credit: 1200 }] });
    await ledger.createEntry({ entry_date: '2030-01-20', lines: [{ account_id: caja, debit: 4000 }, { account_id: ventas, credit: 4000 }] });
    // Un asiento REVERSADO no debe contar.
    const rev: any = await ledger.createEntry({ entry_date: '2030-02-01', lines: [{ account_id: gastos, debit: 999 }, { account_id: caja, credit: 999 }] });
    await ledger.reverseEntry(rev.id, { entry_date: '2030-02-02' });
    // Un asiento FUERA del año fiscal no debe contar.
    await ledger.createEntry({ entry_date: '2031-03-01', lines: [{ account_id: gastos, debit: 777 }, { account_id: caja, credit: 777 }] });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cuenta DEUDORA (gasto): real = débito − crédito; sobregiro positivo', async () => {
    const rows: any[] = await budgets.vsActual(budgetId, false);
    const g = rows.find((r) => r.account_id === gastos)!;
    // El reversado (999) se excluye porque su original pasó a `reversed`, pero SU contra-asiento
    // (crédito 999) sí postea → el neto del par reversado es 0. El de 2031 queda fuera del año.
    expect(g.budget).toBe(1000);
    expect(g.actual).toBe(1200);
    expect(g.variance).toBe(200); // sobregiro
    expect(g.variance_pct).toBe(0.2);
  });

  it('cuenta ACREEDORA (ingreso): real = crédito − débito; por debajo del objetivo → desvío negativo', async () => {
    const rows: any[] = await budgets.vsActual(budgetId, false);
    const v = rows.find((r) => r.account_id === ventas)!;
    expect(v.budget).toBe(5000);
    expect(v.actual).toBe(4000); // normalizado (crédito − débito), no −4000
    expect(v.variance).toBe(-1000);
    expect(v.variance_pct).toBe(-0.2);
  });

  it('cuenta con real y SIN presupuesto aparece con budget 0 y pct null', async () => {
    const rows: any[] = await budgets.vsActual(budgetId, false);
    const c = rows.find((r) => r.account_id === caja)!;
    expect(c.budget).toBe(0);
    expect(c.variance_pct).toBeNull();
    // Caja (deudora): +4000 (venta) − 1200 (gasto) − 999 + 999 (par reversado) = 2800.
    expect(c.actual).toBe(2800);
  });

  it('?by=month desglosa por mes', async () => {
    const rows: any[] = await budgets.vsActual(budgetId, true);
    const gEnero = rows.find((r) => r.account_id === gastos && r.month === 1)!;
    expect(gEnero.budget).toBe(1000);
    expect(gEnero.actual).toBe(1200);
    // Febrero: solo el par reversado (neto 0) → no hay presupuesto ni real neto.
    const gFebrero = rows.find((r) => r.account_id === gastos && r.month === 2);
    if (gFebrero) expect(gFebrero.actual).toBe(0);
  });

  it('presupuesto inexistente → 404', async () => {
    await expect(budgets.vsActual('00000000-0000-0000-0000-000000000000', false)).rejects.toMatchObject({ status: 404 });
  });
});
