import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { CommerceService } from './commerce.service';
import { PurchasesService } from './purchases.service';

/**
 * Integración de compras (C-2): totales derivados, máquina de estados y gancho idempotente a stock
 * (received → movimiento `in` vía InventoryService.recordMovementInTx). `db.tenant` cae al demo.
 */
describe('commerce — compras', () => {
  let db: DbService;
  let inv: InventoryService;
  let commerce: CommerceService;
  let purchases: PurchasesService;
  let originalCwd: string;
  let tmp: string;
  let supplierId: string;
  let itemId: string;
  let whId: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'purchases-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    commerce = new CommerceService(db);
    purchases = new PurchasesService(db, inv);

    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Insumos SA', supplier_category: 'feed' });
    supplierId = sup.id;
    const item: any = await inv.createItem({ name: 'Maíz compra', unit: 'kg' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Depósito compras' });
    whId = wh.id;
    const animal = await db.one<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]);
    animalId = animal!.id; // el seed demo tiene animales; FK real (fk_purchase_lines_animal_id)
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea la compra con totales DERIVADOS de las líneas (tax_rate fracción)', async () => {
    const p: any = await purchases.create({
      supplier_partner_id: supplierId,
      lines: [
        { item_id: itemId, quantity: 100, unit_price: 2, tax_rate: 0.21, warehouse_id: whId },
        { item_id: itemId, quantity: 10, unit_price: 5, tax_rate: 0.21, warehouse_id: whId },
      ],
    });
    expect(p.status).toBe('draft');
    expect(p.subtotal).toBe(250); // 200 + 50
    expect(p.tax_total).toBe(52.5); // 42 + 10.5
    expect(p.total).toBe(302.5);
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0].line_total).toBe(200);
  });

  it('valida proveedor, líneas y campos', async () => {
    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Cliente puro', customer_segment: 'retail' });
    await expect(purchases.create({ supplier_partner_id: cust.id, lines: [{ item_id: itemId, quantity: 1, unit_price: 1, warehouse_id: whId }] })).rejects.toMatchObject({ status: 400 });
    await expect(purchases.create({ supplier_partner_id: supplierId, lines: [] })).rejects.toMatchObject({ status: 400 });
    await expect(purchases.create({ supplier_partner_id: supplierId, lines: [{ item_id: itemId, quantity: 0, unit_price: 1, warehouse_id: whId }] })).rejects.toMatchObject({ status: 400 });
    await expect(purchases.create({ supplier_partner_id: supplierId, lines: [{ quantity: 1, unit_price: 1 }] })).rejects.toMatchObject({ status: 400 }); // sin item ni animal
  });

  it('received genera stock `in` y es idempotente; no permite recibir dos veces el efecto', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, lines: [{ item_id: itemId, quantity: 30, unit_price: 4, warehouse_id: whId }] });
    const before: any[] = await inv.listStock(whId, itemId);
    const qtyBefore = before[0]?.quantity ?? 0;

    const recv: any = await purchases.updateStatus(p.id, 'received');
    expect(recv.status).toBe('received');
    const after: any[] = await inv.listStock(whId, itemId);
    expect(after[0].quantity).toBe(qtyBefore + 30);

    // Re-enviar 'received' es idempotente (mismo estado): no vuelve a mover stock.
    await purchases.updateStatus(p.id, 'received');
    const after2: any[] = await inv.listStock(whId, itemId);
    expect(after2[0].quantity).toBe(qtyBefore + 30);

    // received → paid permitido; received → canceled NO (409).
    await expect(purchases.updateStatus(p.id, 'canceled')).rejects.toMatchObject({ status: 409 });
    const paid: any = await purchases.updateStatus(p.id, 'paid');
    expect(paid.status).toBe('paid');
  });

  it('recibir una línea de ítem sin warehouse_id falla (400) y no cambia el estado', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, lines: [{ item_id: itemId, quantity: 5, unit_price: 1 }] });
    await expect(purchases.updateStatus(p.id, 'received')).rejects.toMatchObject({ status: 400 });
    const still: any = await purchases.get(p.id);
    expect(still.status).toBe('draft'); // la tx revirtió
  });

  it('línea de animal se registra pero no mueve stock al recibir', async () => {
    const p: any = await purchases.create({ supplier_partner_id: supplierId, lines: [{ animal_id: animalId, quantity: 1, unit_price: 1000, description: 'Toro reproductor' }] });
    const recv: any = await purchases.updateStatus(p.id, 'received');
    expect(recv.status).toBe('received');
    expect(recv.lines[0].animal_id).toBe(animalId);
    expect(recv.lines[0].item_id).toBeNull();
  });
});
