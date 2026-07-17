import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AccountsService } from './accounts.service';
import { TreasuryService } from './treasury.service';

/**
 * Integración de tesorería (G3): el demo NO siembra bancos/pagos/facturas, así que se arma un escenario
 * CONTROLADO sobre el tenant demo (sin interferencia) con inserts directos y se verifican liquidez,
 * flujo de caja, aging y días de cobro/pago con números exactos. Fechas relativas a hoy para que los
 * tramos de aging sean deterministas.
 */
describe('treasury — tesorería y bancos', () => {
  let db: DbService;
  let svc: TreasuryService;
  let accounts: AccountsService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let companyId: string;
  let acc: string; // cuenta contable de la caja/banco
  let partnerId: string;

  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); // n días atrás; negativo = futuro

  const pay = (direction: string, amount: number, date: string) =>
    db.query<{ id: string }>(
      `INSERT INTO payments (tenant_id, company_id, direction, payment_date, amount, currency, method, account_id) VALUES ($1,$2,$3,$4,$5,'ARS','transfer',$6) RETURNING id`,
      [tenantId, companyId, direction, date, amount, acc],
    );
  const invoice = (direction: string, num: string, total: number, issue: string, due: string, status = 'issued') =>
    db.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, company_id, direction, partner_id, invoice_number, issue_date, due_date, currency, total, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'ARS',$8,$9) RETURNING id`,
      [tenantId, companyId, direction, partnerId, num, issue, due, total, status],
    );
  const allocate = (paymentId: string, invoiceId: string, amount: number) =>
    db.query(`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,$4)`, [tenantId, paymentId, invoiceId, amount]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'treasury-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new TreasuryService(db);
    accounts = new AccountsService(db);
    tenantId = db.tenant;
    companyId = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [tenantId]))[0].id;
    partnerId = (await db.query<{ id: string }>(`INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'both','Socio Tesorería') RETURNING id`, [tenantId, companyId]))[0].id;
    acc = ((await accounts.createAccount({ code: '1.1.99', name: 'Banco Test', type: 'asset' })) as any).id;
    await db.query(`INSERT INTO bank_accounts (tenant_id, company_id, name, bank_name, currency, ledger_account_id) VALUES ($1,$2,'Cuenta Corriente','Banco Nación','ARS',$3)`, [tenantId, companyId, acc]);

    // Pagos (todos sobre la cuenta acc): entradas 1000+500+100, salidas 300+300 → saldo 1000.
    await pay('inbound', 1000, day(120));
    await pay('inbound', 500, day(60));
    await pay('outbound', 300, day(90));
    const p4 = (await pay('inbound', 100, day(15)))[0].id; // imputado a R2
    const p5 = (await pay('outbound', 300, day(20)))[0].id; // imputado a P2

    // Facturas para aging (por cobrar = issued, por pagar = received).
    await invoice('issued', 'R1', 400, day(5), day(-10)); // no vencida → not_due, saldo 400
    const r2 = (await invoice('issued', 'R2', 250, day(30), day(15)))[0].id; // saldo 150 tras imputar 100 → d1_30
    await invoice('issued', 'R3', 200, day(120), day(100)); // d90_plus, saldo 200
    await invoice('received', 'P1', 600, day(50), day(45)); // d31_60, saldo 600
    const p2inv = (await invoice('received', 'P2', 300, day(50), day(40), 'paid'))[0].id; // saldada → fuera del aging
    await allocate(p4, r2, 100);
    await allocate(p5, p2inv, 300);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('liquidez: saldo por cuenta = entradas − salidas', async () => {
    const res: any = await svc.summary(day(400), day(0));
    const cta = res.liquidity.accounts.find((a: any) => a.name === 'Cuenta Corriente');
    expect(cta.balance).toBe(1000); // 1600 − 600
    expect(res.liquidity.total).toBe(1000);
  });

  it('flujo de caja del período: cobros, pagos y neto', async () => {
    const res: any = await svc.summary(day(400), day(0));
    expect(res.cashflow.inflow).toBe(1600);
    expect(res.cashflow.outflow).toBe(600);
    expect(res.cashflow.net).toBe(1000);
    expect(res.cashflow.series.length).toBeGreaterThan(0);
  });

  it('aging: saldos abiertos por tramo, saldada excluida', async () => {
    const res: any = await svc.summary(day(400), day(0));
    const r = res.aging.receivable.buckets;
    expect(r.not_due).toBe(400);
    expect(r.d1_30).toBe(150); // R2: 250 − 100 imputado
    expect(r.d90_plus).toBe(200);
    expect(res.aging.receivable.total).toBe(750);
    expect(res.aging.payable.buckets.d31_60).toBe(600);
    expect(res.aging.payable.total).toBe(600); // P2 saldada NO cuenta
  });

  it('días de cobro/pago: promedio (fecha de pago − emisión) por imputación', async () => {
    const res: any = await svc.summary(day(400), day(0));
    expect(res.collection_days.receivable).toBe(15); // R2: day(15) − day(30)
    expect(res.collection_days.payable).toBe(30); // P2: day(20) − day(50)
  });
});
