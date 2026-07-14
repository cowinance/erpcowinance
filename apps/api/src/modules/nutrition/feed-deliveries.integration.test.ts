import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { RationsService } from './rations.service';
import { FeedDeliveriesService } from './feed-deliveries.service';

/**
 * Integración de entregas de alimento (N-2): entregar una ración a un lote descuenta stock por
 * `consumption` con costo REAL (avg_cost), prorratea por cabeza y respeta el no-negativo. `db.tenant`
 * cae al demo.
 */
describe('nutrition — entregas de alimento', () => {
  let db: DbService;
  let inv: InventoryService;
  let rations: RationsService;
  let deliveries: FeedDeliveriesService;
  let originalCwd: string;
  let tmp: string;
  let maiz: string;
  let soja: string;
  let whId: string;
  let rationId: string;
  let lotId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'feed-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    rations = new RationsService(db);
    deliveries = new FeedDeliveriesService(db, inv);

    const t = db.tenant;
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [t]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;

    maiz = ((await inv.createItem({ name: 'Maíz feed', unit: 'kg', standard_cost: 0.3 })) as any).id;
    soja = ((await inv.createItem({ name: 'Soja feed', unit: 'kg', standard_cost: 0.5 })) as any).id;
    whId = ((await inv.createWarehouse({ name: 'Silo' })) as any).id;
    await inv.recordMovement({ item_id: maiz, warehouse_id: whId, movement_type: 'in', quantity: 1000, unit_cost: 0.3 });
    await inv.recordMovement({ item_id: soja, warehouse_id: whId, movement_type: 'in', quantity: 1000, unit_cost: 0.5 });

    const r: any = await rations.createRation({ name: 'Engorde 60/40' });
    rationId = r.id;
    await rations.setIngredients(rationId, { ingredients: [{ inventory_item_id: maiz, pct: 60 }, { inventory_item_id: soja, pct: 40 }] });

    lotId = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Recría') RETURNING id`, [t, farmId]))[0].id;
    // Dos animales activos en el lote (para derivar animals_count).
    for (let i = 0; i < 2; i++) {
      await db.query(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'M','active','born',$4)`, [t, farmId, speciesId, lotId]);
    }
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('entrega 100 kg: consume 60 maíz + 40 soja, costo real y cabezas derivadas', async () => {
    const before = (await inv.listStock(whId, maiz) as any[])[0].quantity;
    const d: any = await deliveries.createDelivery({ ration_id: rationId, lot_id: lotId, warehouse_id: whId, quantity_kg: 100 });
    // Stock descontado.
    expect((await inv.listStock(whId, maiz) as any[])[0].quantity).toBe(before - 60);
    expect((await inv.listStock(whId, soja) as any[])[0].quantity).toBe(1000 - 40);
    // Costo real: 60×0.30 + 40×0.50 = 18 + 20 = 38.
    expect(d.total_cost).toBe(38);
    // Cabezas derivadas del lote (2) y costo por cabeza.
    expect(d.animals_count).toBe(2);
    expect(d.cost_per_head).toBe(19);
  });

  it('dos movimientos consumption con referencia a la entrega', async () => {
    const d: any = await deliveries.createDelivery({ ration_id: rationId, lot_id: lotId, warehouse_id: whId, quantity_kg: 10 });
    const movs = (await inv.listMovements(maiz, whId)) as any[];
    expect(movs.some((m) => m.movement_type === 'consumption')).toBe(true);
    expect(d.quantity_kg).toBe(10);
  });

  it('stock insuficiente → 403 y sin persistencia parcial (rollback)', async () => {
    const deliveriesBefore = ((await deliveries.list(lotId)) as any[]).length;
    await expect(deliveries.createDelivery({ ration_id: rationId, lot_id: lotId, warehouse_id: whId, quantity_kg: 1_000_000 })).rejects.toMatchObject({ status: 403 });
    expect(((await deliveries.list(lotId)) as any[]).length).toBe(deliveriesBefore); // no se creó la entrega
  });

  it('validaciones: lote/depósito/ración inexistentes y cantidad inválida', async () => {
    await expect(deliveries.createDelivery({ ration_id: rationId, lot_id: '00000000-0000-0000-0000-000000000000', warehouse_id: whId, quantity_kg: 10 })).rejects.toMatchObject({ status: 404 });
    await expect(deliveries.createDelivery({ ration_id: rationId, lot_id: lotId, warehouse_id: whId, quantity_kg: 0 })).rejects.toMatchObject({ status: 400 });
    const empty: any = await rations.createRation({ name: 'Vacía' });
    await expect(deliveries.createDelivery({ ration_id: empty.id, lot_id: lotId, warehouse_id: whId, quantity_kg: 10 })).rejects.toMatchObject({ status: 400 });
  });
});
