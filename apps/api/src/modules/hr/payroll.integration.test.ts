import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AccountsService } from '../finance/accounts.service';
import { LedgerService } from '../finance/ledger.service';
import { PostingService } from '../finance/posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { PurchasesService } from '../commerce/purchases.service';
import { SalesService } from '../commerce/sales.service';
import { EmployeesService } from './employees.service';
import { PayrollService } from './payroll.service';

/**
 * Integración de liquidaciones (H-2): crear + aprobar (asiento devengado) + pagar (asiento de caja),
 * balanceados, con roles y período. `db.tenant` cae al demo.
 */
describe('hr — liquidaciones', () => {
  let db: DbService;
  let accounts: AccountsService;
  let posting: PostingService;
  let payroll: PayrollService;
  let employees: EmployeesService;
  let originalCwd: string;
  let tmp: string;
  let emp1: string;
  let emp2: string;
  let roles: Record<string, string>;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'payroll-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    accounts = new AccountsService(db);
    const ledger = new LedgerService(db);
    const inv = new InventoryService(db);
    posting = new PostingService(db, accounts, ledger, new PurchasesService(db, inv), new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db))));
    payroll = new PayrollService(db, ledger, posting);
    employees = new EmployeesService(db);

    const mk = async (code: string, name: string, type: string) => ((await accounts.createAccount({ code, name, type })) as any).id;
    roles = {
      salary_expense: await mk('6.1.01', 'Sueldos y jornales', 'expense'),
      salaries_payable: await mk('2.1.03', 'Remuneraciones a pagar', 'liability'),
      payroll_withholdings: await mk('2.1.04', 'Retenciones a pagar', 'liability'),
      cash: await mk('1.1.01', 'Caja', 'asset'),
    };
    await accounts.createPeriod({ name: 'Amplio', start_date: '2020-01-01', end_date: '2035-12-31' });
    await posting.setPostingAccounts(roles);

    emp1 = ((await employees.create({ full_name: 'Empleado 1', employment_type: 'permanent' })) as any).id;
    emp2 = ((await employees.create({ full_name: 'Empleado 2', employment_type: 'permanent' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const ledgerGet = (id: string) => new LedgerService(db).get(id);

  it('crea la liquidación con net derivado y total_amount = Σ gross', async () => {
    const run: any = await payroll.create({ period: '2030-05-01', items: [{ employee_id: emp1, gross: 1000, deductions: 170 }, { employee_id: emp2, gross: 500 }] });
    expect(run.status).toBe('draft');
    expect(run.total_amount).toBe(1500);
    const i1 = run.items.find((x: any) => x.employee_id === emp1);
    expect(i1.net).toBe(830); // 1000 - 170
    await expect(payroll.create({ period: '2030-05-01', items: [{ employee_id: emp1, gross: 100, deductions: 200 }] })).rejects.toMatchObject({ status: 400 });
    await expect(payroll.create({ period: '2030-05-01', items: [{ employee_id: '00000000-0000-0000-0000-000000000000', gross: 100 }] })).rejects.toMatchObject({ status: 404 });
  });

  it('aprobar postea el devengado balanceado (D sueldos, H a pagar, H retenciones) y sella el asiento', async () => {
    const run: any = await payroll.create({ period: '2030-06-01', items: [{ employee_id: emp1, gross: 1000, deductions: 170 }] });
    const approved: any = await payroll.updateStatus(run.id, 'approved');
    expect(approved.status).toBe('approved');
    expect(approved.journal_entry_id).toBeTruthy();
    const e: any = await ledgerGet(approved.journal_entry_id);
    const line = (acc: string) => e.lines.find((l: any) => l.account_id === acc);
    expect(line(roles.salary_expense).debit).toBe(1000);
    expect(line(roles.salaries_payable).credit).toBe(830);
    expect(line(roles.payroll_withholdings).credit).toBe(170);
  });

  it('sin deducciones: asiento de 2 líneas (sin retenciones)', async () => {
    const run: any = await payroll.create({ period: '2030-07-01', items: [{ employee_id: emp2, gross: 800 }] });
    const approved: any = await payroll.updateStatus(run.id, 'approved');
    const e: any = await ledgerGet(approved.journal_entry_id);
    expect(e.lines).toHaveLength(2);
    expect(e.total_debit).toBe(e.total_credit);
  });

  it('pagar postea la caja (D a pagar, H caja) e idempotencia de transición', async () => {
    const run: any = await payroll.create({ period: '2030-08-01', items: [{ employee_id: emp1, gross: 1000, deductions: 170 }] });
    await payroll.updateStatus(run.id, 'approved');
    const paid: any = await payroll.updateStatus(run.id, 'paid');
    expect(paid.status).toBe('paid');
    // Buscar el asiento de pago (source_type payroll_payment).
    const payEntry = (await db.query<any>(`SELECT id FROM journal_entries WHERE source_type='payroll_payment' AND source_id=$1`, [run.id]))[0];
    const e: any = await ledgerGet(payEntry.id);
    expect(e.lines.find((l: any) => l.account_id === roles.salaries_payable).debit).toBe(830);
    expect(e.lines.find((l: any) => l.account_id === roles.cash).credit).toBe(830);
    // Re-enviar 'paid' es idempotente (no duplica).
    await payroll.updateStatus(run.id, 'paid');
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM journal_entries WHERE source_type='payroll_payment' AND source_id=$1`, [run.id]))[0].n).toBe(1);
  });

  it('transición inválida (draft→paid) → 409; rol faltante → 400', async () => {
    const run: any = await payroll.create({ period: '2030-09-01', items: [{ employee_id: emp1, gross: 100 }] });
    await expect(payroll.updateStatus(run.id, 'paid')).rejects.toMatchObject({ status: 409 });
    // Quitar un rol requerido y aprobar → 400.
    await posting.setPostingAccounts({ salaries_payable: roles.salaries_payable, payroll_withholdings: roles.payroll_withholdings, cash: roles.cash });
    await expect(payroll.updateStatus(run.id, 'approved')).rejects.toMatchObject({ status: 400 });
    await posting.setPostingAccounts(roles); // restaurar
  });
});
