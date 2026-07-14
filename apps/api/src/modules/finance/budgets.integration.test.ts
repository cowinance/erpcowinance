import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';

/**
 * Integración de presupuestos (BG-1): CRUD, carga de líneas EN BLOQUE (cuenta imputable, mes 1..12),
 * estados y bloqueo de edición fuera de `draft`. `db.tenant` cae al demo.
 */
describe('finance — presupuestos', () => {
  let db: DbService;
  let accounts: AccountsService;
  let budgets: BudgetsService;
  let originalCwd: string;
  let tmp: string;
  let gastos: string;
  let grupo: string;
  let centro: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'budgets-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    accounts = new AccountsService(db);
    budgets = new BudgetsService(db, accounts);

    gastos = ((await accounts.createAccount({ code: '5.1.10', name: 'Alimentación', type: 'expense' })) as any).id;
    grupo = ((await accounts.createAccount({ code: '5', name: 'Gastos', type: 'expense', is_postable: false })) as any).id;
    centro = ((await accounts.createCostCenter({ name: 'Rodeo cría', level: 'company' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un presupuesto y valida name / fiscal_year', async () => {
    const b: any = await budgets.create({ name: 'Presupuesto 2030', fiscal_year: 2030 });
    expect(b.status).toBe('draft');
    expect(b.fiscal_year).toBe(2030);
    await expect(budgets.create({ name: '  ', fiscal_year: 2030 })).rejects.toMatchObject({ status: 400 });
    await expect(budgets.create({ name: 'X', fiscal_year: 'no' })).rejects.toMatchObject({ status: 400 });
  });

  it('carga líneas en bloque (reemplazo atómico) con centro de costo', async () => {
    const b: any = await budgets.create({ name: 'Con líneas', fiscal_year: 2030 });
    const withLines: any = await budgets.setLines(b.id, {
      lines: [
        { account_id: gastos, month: 1, amount: 1000, cost_center_id: centro },
        { account_id: gastos, month: 2, amount: 1200 },
      ],
    });
    expect(withLines.lines).toHaveLength(2);
    expect(withLines.lines[0].amount).toBe(1000);
    // Reemplazo: el set nuevo sustituye al anterior.
    const replaced: any = await budgets.setLines(b.id, { lines: [{ account_id: gastos, month: 3, amount: 500 }] });
    expect(replaced.lines).toHaveLength(1);
    expect(replaced.lines[0].month).toBe(3);
  });

  it('valida cuenta imputable, cuenta ajena, mes y monto', async () => {
    const b: any = await budgets.create({ name: 'Validaciones', fiscal_year: 2030 });
    await expect(budgets.setLines(b.id, { lines: [{ account_id: grupo, month: 1, amount: 10 }] })).rejects.toMatchObject({ status: 400 }); // no imputable
    await expect(budgets.setLines(b.id, { lines: [{ account_id: '00000000-0000-0000-0000-000000000000', month: 1, amount: 10 }] })).rejects.toMatchObject({ status: 404 });
    await expect(budgets.setLines(b.id, { lines: [{ account_id: gastos, month: 13, amount: 10 }] })).rejects.toMatchObject({ status: 400 });
    await expect(budgets.setLines(b.id, { lines: [{ account_id: gastos, month: 1, amount: 'x' }] })).rejects.toMatchObject({ status: 400 });
    await expect(budgets.setLines(b.id, { lines: 'no-array' })).rejects.toMatchObject({ status: 400 });
  });

  it('estados: draft→approved→closed; aprobado no acepta edición de líneas (409)', async () => {
    const b: any = await budgets.create({ name: 'Estados', fiscal_year: 2030 });
    await budgets.setLines(b.id, { lines: [{ account_id: gastos, month: 1, amount: 100 }] });
    await expect(budgets.updateStatus(b.id, 'closed')).rejects.toMatchObject({ status: 409 }); // draft→closed no permitido
    const ap: any = await budgets.updateStatus(b.id, 'approved');
    expect(ap.status).toBe('approved');
    await expect(budgets.setLines(b.id, { lines: [{ account_id: gastos, month: 2, amount: 200 }] })).rejects.toMatchObject({ status: 409 }); // aprobado no se edita
    const cl: any = await budgets.updateStatus(b.id, 'closed');
    expect(cl.status).toBe('closed');
    await expect(budgets.updateStatus(b.id, 'approved')).rejects.toMatchObject({ status: 409 }); // closed terminal
  });
});
