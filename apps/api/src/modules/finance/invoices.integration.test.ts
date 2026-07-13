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
import { InvoicesService } from './invoices.service';

/**
 * Integración de facturas (F-3a): emitir desde venta/compra, saldo pendiente derivado, una por
 * documento/dirección y anulación. `db.tenant` cae al demo.
 */
describe('finance — facturas', () => {
  let db: DbService;
  let inv: InventoryService;
  let commerce: CommerceService;
  let purchases: PurchasesService;
  let sales: SalesService;
  let invoices: InvoicesService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let supplierId: string;
  let itemId: string;
  let whId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'invoices-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    commerce = new CommerceService(db);
    purchases = new PurchasesService(db, inv);
    sales = new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    invoices = new InvoicesService(db, purchases, sales);

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Cliente F3', customer_segment: 'retail' });
    customerId = cust.id;
    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Proveedor F3', supplier_category: 'feed' });
    supplierId = sup.id;
    const item: any = await inv.createItem({ name: 'Insumo F3', unit: 'kg' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Dep F3' });
    whId = wh.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('emite factura desde una venta: issued, total/partner del documento, saldo = total', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-10', lines: [{ item_id: itemId, quantity: 10, unit_price: 100, tax_rate: 0.21 }] });
    const invoice: any = await invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: 'A-0001-00000001' });
    expect(invoice.direction).toBe('issued');
    expect(invoice.status).toBe('issued');
    expect(invoice.total).toBe(1210); // 1000 + 21% IVA
    expect(invoice.partner_id).toBe(customerId);
    expect(invoice.outstanding).toBe(1210); // sin pagos aún
  });

  it('emite factura desde una compra: received', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, purchase_date: '2030-05-11', lines: [{ item_id: itemId, quantity: 5, unit_price: 40, warehouse_id: whId }] });
    const invoice: any = await invoices.createFromDocument({ kind: 'purchase', document_id: p.id, invoice_number: 'B-0001-00000001' });
    expect(invoice.direction).toBe('received');
    expect(invoice.partner_id).toBe(supplierId);
    expect(invoice.total).toBe(200);
  });

  it('valida kind, número obligatorio; una sola factura vigente por documento/dirección (409)', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-12', lines: [{ item_id: itemId, quantity: 1, unit_price: 50 }] });
    await expect(invoices.createFromDocument({ kind: 'x', document_id: s.id, invoice_number: 'Z' })).rejects.toMatchObject({ status: 400 });
    await expect(invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: '   ' })).rejects.toMatchObject({ status: 400 });
    await invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: 'A-0001-00000002' });
    await expect(invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: 'A-0001-00000003' })).rejects.toMatchObject({ status: 409 });
  });

  it('anula una factura sin imputaciones; luego se puede re-emitir para el mismo documento', async () => {
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', sale_date: '2030-05-13', lines: [{ item_id: itemId, quantity: 2, unit_price: 30 }] });
    const invoice: any = await invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: 'A-0001-00000010' });
    const voided: any = await invoices.voidInvoice(invoice.id);
    expect(voided.status).toBe('void');
    // Al estar anulada la anterior, se puede emitir otra para el mismo documento.
    const reissued: any = await invoices.createFromDocument({ kind: 'sale', document_id: s.id, invoice_number: 'A-0001-00000011' });
    expect(reissued.status).toBe('issued');
  });

  it('listado por dirección y saldo pendiente', async () => {
    const issued: any[] = await invoices.list('issued');
    const received: any[] = await invoices.list('received');
    expect(issued.every((i) => i.direction === 'issued')).toBe(true);
    expect(received.every((i) => i.direction === 'received')).toBe(true);
    expect(issued[0]).toHaveProperty('outstanding');
  });
});
