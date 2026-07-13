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

/**
 * Integración de asientos automáticos (F-2): mapa rol→cuenta, posteo de venta/compra a asientos
 * balanceados, idempotencia, roles faltantes y período. `db.tenant` cae al demo.
 */
describe('finance — asientos automáticos desde documentos', () => {
  let db: DbService;
  let accounts: AccountsService;
  let posting: PostingService;
  let commerce: CommerceService;
  let purchases: PurchasesService;
  let sales: SalesService;
  let inv: InventoryService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let supplierId: string;
  let itemId: string;
  let whId: string;
  let fullMap: Record<string, string>;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'posting-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    accounts = new AccountsService(db);
    const ledger = new LedgerService(db);
    commerce = new CommerceService(db);
    purchases = new PurchasesService(db, inv);
    sales = new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    posting = new PostingService(db, accounts, ledger, purchases, sales);

    const mk = async (code: string, name: string, type: string) => ((await accounts.createAccount({ code, name, type })) as any).id;
    fullMap = {
      receivable: await mk('1.1.02', 'Deudores', 'asset'),
      sales_income: await mk('4.1.01', 'Ventas', 'income'),
      vat_debit: await mk('2.1.01', 'IVA débito', 'liability'),
      purchases: await mk('5.1.01', 'Compras', 'expense'),
      vat_credit: await mk('1.1.03', 'IVA crédito', 'asset'),
      payable: await mk('2.1.02', 'Proveedores', 'liability'),
    };
    await accounts.createPeriod({ name: 'Ej. 2030', start_date: '2030-01-01', end_date: '2030-12-31' });
    await posting.setPostingAccounts(fullMap);

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Cliente F2', customer_segment: 'retail' });
    customerId = cust.id;
    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Proveedor F2', supplier_category: 'feed' });
    supplierId = sup.id;
    const item: any = await inv.createItem({ name: 'Insumo F2', unit: 'kg' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Dep F2' });
    whId = wh.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('setPostingAccounts valida que las cuentas sean imputables y de la company', async () => {
    const grupo: any = await accounts.createAccount({ code: '1', name: 'Activo', type: 'asset', is_postable: false });
    await expect(posting.setPostingAccounts({ ...fullMap, receivable: grupo.id })).rejects.toMatchObject({ status: 400 });
    await expect(posting.setPostingAccounts({ ...fullMap, payable: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 400 });
    await posting.setPostingAccounts(fullMap); // restaurar
  });

  it('postea una venta con IVA → asiento balanceado de 3 líneas + journal_entry_id sellado', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-10', lines: [{ item_id: itemId, quantity: 10, unit_price: 100, tax_rate: 0.21 }] });
    const res: any = await posting.postDocument('sale', s.id);
    expect(res.already_posted).toBe(false);
    const e = res.entry;
    expect(e.total_debit).toBe(e.total_credit);
    expect(e.total_debit).toBe(1210); // total = 1000 + 210
    const byRole = (acc: string) => e.lines.find((l: any) => l.account_id === acc);
    expect(byRole(fullMap.receivable).debit).toBe(1210);
    expect(byRole(fullMap.sales_income).credit).toBe(1000);
    expect(byRole(fullMap.vat_debit).credit).toBe(210);
    // journal_entry_id sellado en la venta.
    expect((await sales.get(s.id) as any).journal_entry_id).toBe(e.id);
  });

  it('postea una compra con IVA → 3 líneas (D compras, D IVA crédito, H proveedores)', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, purchase_date: '2030-05-11', lines: [{ item_id: itemId, quantity: 5, unit_price: 40, tax_rate: 0.21, warehouse_id: whId }] });
    const res: any = await posting.postDocument('purchase', p.id);
    const e = res.entry;
    expect(e.total_debit).toBe(e.total_credit);
    const byRole = (acc: string) => e.lines.find((l: any) => l.account_id === acc);
    expect(byRole(fullMap.purchases).debit).toBe(200);
    expect(byRole(fullMap.vat_credit).debit).toBe(42);
    expect(byRole(fullMap.payable).credit).toBe(242);
  });

  it('venta sin impuesto → asiento de 2 líneas (sin IVA)', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-12', lines: [{ item_id: itemId, quantity: 2, unit_price: 50 }] });
    const res: any = await posting.postDocument('sale', s.id);
    expect(res.entry.lines).toHaveLength(2);
    expect(res.entry.total_debit).toBe(100);
  });

  it('idempotente: postear dos veces devuelve el mismo asiento', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-13', lines: [{ item_id: itemId, quantity: 1, unit_price: 10 }] });
    const first: any = await posting.postDocument('sale', s.id);
    const second: any = await posting.postDocument('sale', s.id);
    expect(second.already_posted).toBe(true);
    expect(second.journal_entry_id).toBe(first.entry.id);
  });

  it('rol faltante → 400; fecha fuera de período abierto → 400', async () => {
    // Mapa sin vat_debit → una venta con IVA no puede postear.
    await posting.setPostingAccounts({ receivable: fullMap.receivable, sales_income: fullMap.sales_income, purchases: fullMap.purchases, payable: fullMap.payable, vat_credit: fullMap.vat_credit });
    const taxed: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-14', lines: [{ item_id: itemId, quantity: 1, unit_price: 100, tax_rate: 0.21 }] });
    await expect(posting.postDocument('sale', taxed.id)).rejects.toMatchObject({ status: 400 });
    await posting.setPostingAccounts(fullMap); // restaurar

    // Fecha fuera de todo período abierto.
    const offPeriod: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2029-01-01', lines: [{ item_id: itemId, quantity: 1, unit_price: 10 }] });
    await expect(posting.postDocument('sale', offPeriod.id)).rejects.toMatchObject({ status: 400 });
  });
});
