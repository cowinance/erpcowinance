import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { CommerceService } from './commerce.service';
import { SalesService } from './sales.service';

/**
 * Integración de ventas (C-3): totales derivados; entrega → `out` de stock y transición del animal a
 * `sold` que converge en devices (status + status_changed_at + versión LWW + timeline + changeset
 * server-origin). `db.tenant` cae al demo.
 */
describe('commerce — ventas', () => {
  let db: DbService;
  let inv: InventoryService;
  let sales: SalesService;
  let commerce: CommerceService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let itemId: string;
  let whId: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'sales-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    const animalStatus = new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    sales = new SalesService(db, inv, animalStatus);
    commerce = new CommerceService(db);

    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Frigorífico Norte', customer_segment: 'slaughterhouse' });
    customerId = cust.id;
    const item: any = await inv.createItem({ name: 'Ternero venta', unit: 'un' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Depósito ventas' });
    whId = wh.id;
    await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 10 });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function activeAnimal(): Promise<string> {
    return (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','active','born') RETURNING id`, [tenantId, farmId, speciesId]))[0].id;
  }

  it('crea la venta con totales DERIVADOS y type válido', async () => {
    const s: any = await sales.create({
      customer_partner_id: customerId,
      type: 'product',
      lines: [{ item_id: itemId, quantity: 4, unit_price: 25, tax_rate: 0.21 }],
    });
    expect(s.status).toBe('draft');
    expect(s.subtotal).toBe(100);
    expect(s.tax_total).toBe(21);
    expect(s.total).toBe(121);
    await expect(sales.create({ customer_partner_id: customerId, type: 'no-existe', lines: [{ item_id: itemId, quantity: 1, unit_price: 1 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('validación de cliente: un proveedor puro no puede ser cliente de una venta', async () => {
    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Solo proveedor', supplier_category: 'feed' });
    await expect(sales.create({ customer_partner_id: sup.id, type: 'product', lines: [{ item_id: itemId, quantity: 1, unit_price: 1 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('entrega de ítem → `out` de stock; idempotente; sin saldo → 403', async () => {
    const before: any[] = await inv.listStock(whId, itemId);
    const q0 = before[0].quantity;
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemId, quantity: 10, unit_price: 25 }] });
    const del: any = await sales.updateStatus(s.id, 'delivered');
    expect(del.status).toBe('delivered');
    expect((await inv.listStock(whId, itemId))[0].quantity).toBe(q0 - 10);
    // Re-entregar es idempotente (mismo estado): no vuelve a descontar.
    await sales.updateStatus(s.id, 'delivered');
    expect((await inv.listStock(whId, itemId))[0].quantity).toBe(q0 - 10);

    // Venta que supera el saldo → 403 y la tx revierte (queda en draft).
    const huge: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemId, quantity: 100000, unit_price: 25 }] });
    await expect(sales.updateStatus(huge.id, 'delivered')).rejects.toMatchObject({ status: 403 });
    expect((await sales.get(huge.id) as any).status).toBe('draft');
  });

  it('entrega de animal → `sold` convergente: status, versión LWW, timeline y changeset server-origin', async () => {
    const a = await activeAnimal();
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1500, weight_kg: 420 }] });
    const del: any = await sales.updateStatus(s.id, 'delivered');
    expect(del.status).toBe('delivered');

    const ar = (await db.query<any>(`SELECT status, status_changed_at FROM animals WHERE id=$1`, [a]))[0];
    expect(ar.status).toBe('sold');
    expect(ar.status_changed_at).toBeTruthy();

    const ev = await db.query<any>(`SELECT payload FROM animal_events WHERE animal_id=$1 AND event_type='sale'`, [a]);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.sale_id).toBe(s.id);

    const v = (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [a]))[0];
    expect(v.versions.status).toBeTruthy();

    const cs = await db.query<any>(`SELECT operations FROM sync_changesets WHERE source='server' AND origin_ref=$1`, [`sale:${s.id}`]);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0]).toMatchObject({ kind: 'put', table: 'animals', rowId: a, fields: { status: 'sold' } });
  });

  it('vender un animal ya vendido/no activo → 409; cancelar tras delivered → 409', async () => {
    const a = await activeAnimal();
    const s1: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1500 }] });
    await sales.updateStatus(s1.id, 'delivered');
    // cancelar tras delivered → 409
    await expect(sales.updateStatus(s1.id, 'canceled')).rejects.toMatchObject({ status: 409 });

    // otra venta del mismo animal: al entregar, el animal ya no está activo → 409, y revierte.
    const s2: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1600 }] });
    await expect(sales.updateStatus(s2.id, 'delivered')).rejects.toMatchObject({ status: 409 });
    expect((await sales.get(s2.id) as any).status).toBe('draft');
  });
});
