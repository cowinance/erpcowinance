import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from './inventory.service';

/**
 * Integración del kardex (INV-2a): un movimiento actualiza el saldo (regla única); avg_cost
 * ponderado en entradas; salidas restan sin cambiar avg; sin stock negativo; validación de signo;
 * ajuste ±. `db.tenant` cae al tenant demo.
 */
describe('inventory — movimientos y existencias', () => {
  let db: DbService;
  let inv: InventoryService;
  let itemId: string;
  let whId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'inv-mov-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    itemId = ((await inv.createItem({ name: 'Maíz kardex', unit: 'kg' })) as any).id;
    whId = ((await inv.createWarehouse({ name: 'Depósito kardex' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('entrada suma y pondera avg_cost; salida resta sin cambiarlo; sin negativo; ajuste ±', async () => {
    const a = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 2 });
    expect(a.level.quantity).toBe(100);
    expect(a.level.avg_cost).toBe(2);

    const b = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 4 });
    expect(b.level.quantity).toBe(200);
    expect(b.level.avg_cost).toBe(3); // (100*2 + 100*4)/200

    const c = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: -50 });
    expect(c.level.quantity).toBe(150);
    expect(c.level.avg_cost).toBe(3); // salida no cambia el costo

    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: -1000 })).rejects.toMatchObject({ status: 403 }); // insuficiente

    const d = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'adjustment', quantity: -10 });
    expect(d.level.quantity).toBe(140);
  });

  it('validación de signo por tipo', async () => {
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: -5 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'zzz', quantity: 5 })).rejects.toMatchObject({ status: 400 });
  });

  it('existencias y kardex reflejan lo registrado', async () => {
    const stock = (await inv.listStock(whId)).find((s: any) => s.item_id === itemId)!;
    expect(stock.quantity).toBe(140);
    expect(stock.warehouse_name).toBe('Depósito kardex');
    const moves = await inv.listMovements(itemId);
    expect(moves.length).toBeGreaterThanOrEqual(4);
    expect(moves[0].item_name).toBe('Maíz kardex');
  });
});
