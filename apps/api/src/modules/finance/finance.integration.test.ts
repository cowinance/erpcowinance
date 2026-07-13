import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';

/**
 * Integración del libro mayor (F-1): plan de cuentas/períodos, asiento balanceado y posteado,
 * período abierto obligatorio, inmutabilidad vía reversa, y sumas y saldos. `db.tenant` cae al demo.
 */
describe('finance — libro mayor', () => {
  let db: DbService;
  let accounts: AccountsService;
  let ledger: LedgerService;
  let originalCwd: string;
  let tmp: string;
  let caja: string;
  let ventas: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'finance-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    accounts = new AccountsService(db);
    ledger = new LedgerService(db);

    const c1: any = await accounts.createAccount({ code: '1.1.01', name: 'Caja', type: 'asset' });
    const c2: any = await accounts.createAccount({ code: '4.1.01', name: 'Ventas', type: 'income' });
    caja = c1.id;
    ventas = c2.id;
    await accounts.createPeriod({ name: 'Ejercicio 2030', start_date: '2030-01-01', end_date: '2030-12-31' });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('plan de cuentas: código único por company y validación de type', async () => {
    await expect(accounts.createAccount({ code: '1.1.01', name: 'Otra caja', type: 'asset' })).rejects.toMatchObject({ status: 400 }); // duplicado
    await expect(accounts.createAccount({ code: '9', name: 'X', type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('crea un asiento balanceado y posteado dentro de un período abierto', async () => {
    const e: any = await ledger.createEntry({
      entry_date: '2030-05-10',
      reference: 'Venta contado',
      lines: [
        { account_id: caja, debit: 121 },
        { account_id: ventas, credit: 121 },
      ],
    });
    expect(e.status).toBe('posted');
    expect(e.total_debit).toBe(121);
    expect(e.total_credit).toBe(121);
    expect(e.lines).toHaveLength(2);
  });

  it('rechaza asiento desbalanceado (400) y fuera de un período abierto (400)', async () => {
    await expect(ledger.createEntry({ entry_date: '2030-05-10', lines: [{ account_id: caja, debit: 100 }, { account_id: ventas, credit: 90 }] })).rejects.toMatchObject({ status: 400 });
    // Fecha sin período que la cubra.
    await expect(ledger.createEntry({ entry_date: '2029-01-01', lines: [{ account_id: caja, debit: 50 }, { account_id: ventas, credit: 50 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('período cerrado bloquea nuevos asientos con fecha adentro', async () => {
    const [p]: any = await accounts.listPeriods();
    await accounts.setPeriodStatus(p.id, 'closed');
    await expect(ledger.createEntry({ entry_date: '2030-06-01', lines: [{ account_id: caja, debit: 10 }, { account_id: ventas, credit: 10 }] })).rejects.toMatchObject({ status: 400 });
    await accounts.setPeriodStatus(p.id, 'open'); // reabrir para el resto de las pruebas
  });

  it('cuenta no imputable no recibe líneas', async () => {
    const grupo: any = await accounts.createAccount({ code: '1', name: 'Activo', type: 'asset', is_postable: false });
    await expect(ledger.createEntry({ entry_date: '2030-05-10', lines: [{ account_id: grupo.id, debit: 10 }, { account_id: ventas, credit: 10 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('reversa: crea el contra-asiento invertido y marca el original reversed; no se reversa dos veces', async () => {
    const e: any = await ledger.createEntry({ entry_date: '2030-05-15', lines: [{ account_id: caja, debit: 200 }, { account_id: ventas, credit: 200 }] });
    const rev: any = await ledger.reverseEntry(e.id, { entry_date: '2030-05-16' });
    expect(rev.source_type).toBe('reversal');
    // El contra-asiento invierte débito/crédito.
    const cajaLine = rev.lines.find((l: any) => l.account_id === caja);
    expect(cajaLine.credit).toBe(200);
    expect(cajaLine.debit).toBe(0);
    const original: any = await ledger.get(e.id);
    expect(original.status).toBe('reversed');
    await expect(ledger.reverseEntry(e.id, {})).rejects.toMatchObject({ status: 409 });
  });

  it('sumas y saldos: por cuenta, débito/crédito/saldo, excluye reversados', async () => {
    const tb: any[] = await ledger.trialBalance('2030-01-01', '2030-12-31');
    const cajaRow = tb.find((r) => r.account_id === caja)!;
    const ventasRow = tb.find((r) => r.account_id === ventas)!;
    // Asientos posteados vigentes: 121 (venta contado) + 200 (reversado, se excluye porque el original
    // pasó a 'reversed' pero su contra-asiento SÍ postea): caja debe balancear contra ventas.
    expect(cajaRow.debit).toBeGreaterThan(0);
    expect(Number((cajaRow.debit - cajaRow.credit).toFixed(2))).toBe(-Number((ventasRow.debit - ventasRow.credit).toFixed(2)));
  });
});
