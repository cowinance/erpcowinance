import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from './inventory.service';

/**
 * Integración de INV-2b: batches CRUD, enforcement de `track_batches` en movimientos, y
 * transferencias (par atómico A→B, el costo viaja, sin negativo). `db.tenant` cae al demo.
 */
describe('inventory — batches y transferencias', () => {
  let db: DbService;
  let inv: InventoryService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'inv-2b-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('track_batches: exige batch en movimientos; valida pertenencia', async () => {
    const item: any = await inv.createItem({ name: 'Vacuna', unit: 'un', track_batches: true });
    const other: any = await inv.createItem({ name: 'Otro', unit: 'un', track_batches: true });
    const wh: any = await inv.createWarehouse({ name: 'Frío' });
    const batch: any = await inv.createBatch({ item_id: item.id, batch_number: 'L-001', expiry_date: '2027-12-31' });

    // Sin batch → 400.
    await expect(inv.recordMovement({ item_id: item.id, warehouse_id: wh.id, movement_type: 'in', quantity: 10 })).rejects.toMatchObject({ status: 400 });
    // Batch de otro ítem → 404.
    const otherBatch: any = await inv.createBatch({ item_id: other.id, batch_number: 'X' });
    await expect(inv.recordMovement({ item_id: item.id, warehouse_id: wh.id, movement_type: 'in', quantity: 10, batch_id: otherBatch.id })).rejects.toMatchObject({ status: 404 });
    // Con su batch → ok.
    const ok = await inv.recordMovement({ item_id: item.id, warehouse_id: wh.id, movement_type: 'in', quantity: 10, batch_id: batch.id });
    expect(ok.level.quantity).toBe(10);

    // Batches CRUD.
    const list = await inv.listBatches(item.id);
    expect(list.find((b: any) => b.id === batch.id)).toBeTruthy();
    await inv.deleteBatch(batch.id);
    expect((await inv.listBatches(item.id)).find((b: any) => b.id === batch.id)).toBeFalsy();
  });

  it('transfer: mueve A→B, el costo viaja, sin negativo; validaciones', async () => {
    const item: any = await inv.createItem({ name: 'Sal', unit: 'kg' });
    const a: any = await inv.createWarehouse({ name: 'Depósito A' });
    const b: any = await inv.createWarehouse({ name: 'Depósito B' });
    await inv.recordMovement({ item_id: item.id, warehouse_id: a.id, movement_type: 'in', quantity: 100, unit_cost: 2 });

    const tr = await inv.recordTransfer({ item_id: item.id, from_warehouse_id: a.id, to_warehouse_id: b.id, quantity: 40 });
    expect(tr.from.quantity).toBe(60);
    expect(tr.to.quantity).toBe(40);
    expect(tr.to.avg_cost).toBe(2); // el costo del origen viaja al destino

    await expect(inv.recordTransfer({ item_id: item.id, from_warehouse_id: a.id, to_warehouse_id: b.id, quantity: 1000 })).rejects.toMatchObject({ status: 403 }); // insuficiente
    await expect(inv.recordTransfer({ item_id: item.id, from_warehouse_id: a.id, to_warehouse_id: a.id, quantity: 5 })).rejects.toMatchObject({ status: 400 }); // mismo depósito
  });
});
