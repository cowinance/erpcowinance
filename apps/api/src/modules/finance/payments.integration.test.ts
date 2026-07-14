import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { CommerceService } from '../commerce/commerce.service';
import { PurchasesService } from '../commerce/purchases.service';
import { SalesService } from '../commerce/sales.service';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

/**
 * Integración de pagos (F-3b): cobro/pago con imputación a facturas, asiento de caja, topes y
 * marcado `paid`. `db.tenant` cae al demo.
 */
describe('finance — pagos e imputaciones', () => {
  let db: DbService;
  let accounts: AccountsService;
  let posting: PostingService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let commerce: CommerceService;
  let sales: SalesService;
  let purchases: PurchasesService;
  let inv: InventoryService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let supplierId: string;
  let itemId: string;
  let whId: string;
  let roles: Record<string, string>;

  const sale = async (qty: number, price: number, date: string) =>
    (await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: date, lines: [{ item_id: itemId, quantity: qty, unit_price: price }] })) as any;
  const issuedInvoice = async (saleId: string, num: string) => (await invoices.createFromDocument({ kind: 'sale', document_id: saleId, invoice_number: num })) as any;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'payments-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    accounts = new AccountsService(db);
    const ledger = new LedgerService(db);
    posting = new PostingService(db, accounts, ledger, new PurchasesService(db, inv), new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db))));
    commerce = new CommerceService(db);
    purchases = new PurchasesService(db, inv);
    sales = new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    invoices = new InvoicesService(db, purchases, sales);
    payments = new PaymentsService(db, ledger, posting);

    const mk = async (code: string, name: string, type: string) => ((await accounts.createAccount({ code, name, type })) as any).id;
    roles = {
      receivable: await mk('1.1.02', 'Deudores', 'asset'),
      sales_income: await mk('4.1.01', 'Ventas', 'income'),
      vat_debit: await mk('2.1.01', 'IVA débito', 'liability'),
      purchases: await mk('5.1.01', 'Compras', 'expense'),
      vat_credit: await mk('1.1.03', 'IVA crédito', 'asset'),
      payable: await mk('2.1.02', 'Proveedores', 'liability'),
      cash: await mk('1.1.01', 'Caja', 'asset'),
    };
    await accounts.createPeriod({ name: 'Ej. 2030', start_date: '2030-01-01', end_date: '2030-12-31' });
    await posting.setPostingAccounts(roles);

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Cliente F3b', customer_segment: 'retail' });
    customerId = cust.id;
    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Proveedor F3b', supplier_category: 'feed' });
    supplierId = sup.id;
    const item: any = await inv.createItem({ name: 'Insumo F3b', unit: 'kg' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Dep F3b' });
    whId = wh.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cobro con efectivo (rol cash) salda la factura issued y postea D caja / H clientes', async () => {
    const s = await sale(1, 1000, '2030-05-10');
    const invoice = await issuedInvoice(s.id, 'A-1');
    const pay: any = await payments.createPayment({ direction: 'inbound', partner_id: customerId, payment_date: '2030-05-11', amount: 1000, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 1000 }] });
    expect(pay.allocations).toHaveLength(1);
    expect(pay.journal_entry_id).toBeTruthy();
    // Factura saldada.
    expect((await invoices.get(invoice.id) as any).status).toBe('paid');
    expect((await invoices.get(invoice.id) as any).outstanding).toBe(0);
    // Asiento: D caja 1000 / H clientes 1000.
    const e: any = await new LedgerService(db).get(pay.journal_entry_id);
    const cajaLine = e.lines.find((l: any) => l.account_id === roles.cash);
    const cliLine = e.lines.find((l: any) => l.account_id === roles.receivable);
    expect(cajaLine.debit).toBe(1000);
    expect(cliLine.credit).toBe(1000);
  });

  it('imputación parcial deja la factura issued con saldo; luego un segundo cobro la salda', async () => {
    const s = await sale(1, 500, '2030-05-12');
    const invoice = await issuedInvoice(s.id, 'A-2');
    await payments.createPayment({ direction: 'inbound', payment_date: '2030-05-12', amount: 200, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 200 }] });
    expect((await invoices.get(invoice.id) as any).status).toBe('issued');
    expect((await invoices.get(invoice.id) as any).outstanding).toBe(300);
    await payments.createPayment({ direction: 'inbound', payment_date: '2030-05-13', amount: 300, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 300 }] });
    expect((await invoices.get(invoice.id) as any).status).toBe('paid');
  });

  it('pago a proveedor (outbound) sobre una compra: D proveedores / H caja, factura paid', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, purchase_date: '2030-05-14', lines: [{ item_id: itemId, quantity: 2, unit_price: 100, warehouse_id: whId }] });
    const invoice: any = await invoices.createFromDocument({ kind: 'purchase', document_id: p.id, invoice_number: 'B-1' });
    const pay: any = await payments.createPayment({ direction: 'outbound', partner_id: supplierId, payment_date: '2030-05-15', amount: 200, method: 'transfer', allocations: [{ invoice_id: invoice.id, amount: 200 }] });
    const e: any = await new LedgerService(db).get(pay.journal_entry_id);
    expect(e.lines.find((l: any) => l.account_id === roles.payable).debit).toBe(200);
    expect(e.lines.find((l: any) => l.account_id === roles.cash).credit).toBe(200);
    expect((await invoices.get(invoice.id) as any).status).toBe('paid');
  });

  it('topes: sobre-imputar factura → 400; Σ imputaciones ≠ monto → 400; dirección incompatible → 400', async () => {
    const s = await sale(1, 100, '2030-05-16');
    const invoice = await issuedInvoice(s.id, 'A-3');
    // Sobre-imputar (120 > 100).
    await expect(payments.createPayment({ direction: 'inbound', amount: 120, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 120 }] })).rejects.toMatchObject({ status: 400 });
    // Σ imputaciones (60) ≠ monto (100).
    await expect(payments.createPayment({ direction: 'inbound', amount: 100, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 60 }] })).rejects.toMatchObject({ status: 400 });
    // Dirección incompatible: outbound sobre una factura issued.
    await expect(payments.createPayment({ direction: 'outbound', amount: 100, method: 'cash', allocations: [{ invoice_id: invoice.id, amount: 100 }] })).rejects.toMatchObject({ status: 400 });
    // La factura sigue sin saldar.
    expect((await invoices.get(invoice.id) as any).status).toBe('issued');
  });

  it('banco: el pago con account_id usa el ledger_account_id de la cuenta bancaria', async () => {
    const banco: any = await accounts.createBankAccount({ name: 'Cta Cte', currency: 'ARS', ledger_account_id: roles.cash });
    const s = await sale(1, 300, '2030-05-17');
    const invoice = await issuedInvoice(s.id, 'A-4');
    const pay: any = await payments.createPayment({ direction: 'inbound', payment_date: '2030-05-17', amount: 300, method: 'transfer', bank_account_id: banco.id, allocations: [{ invoice_id: invoice.id, amount: 300 }] });
    const e: any = await new LedgerService(db).get(pay.journal_entry_id);
    expect(e.lines.find((l: any) => l.account_id === roles.cash).debit).toBe(300); // ledger del banco
  });
});
