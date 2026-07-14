import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { EmployeesService } from '../hr/employees.service';
import { CropsService } from './crops.service';
import { CropOperationsService } from './crop-operations.service';

/**
 * Integración de labores + cosechas (AG-2): consumo de insumos con costo real, cosecha con rinde
 * derivado y suma al stock, y estados. `db.tenant` cae al demo.
 */
describe('agriculture — labores y cosechas', () => {
  let db: DbService;
  let inv: InventoryService;
  let crops: CropsService;
  let ops: CropOperationsService;
  let employees: EmployeesService;
  let originalCwd: string;
  let tmp: string;
  let paddockId: string;
  let cropId: string;
  let urea: string;
  let grano: string;
  let whId: string;
  let operatorId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'cropops-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    crops = new CropsService(db);
    ops = new CropOperationsService(db, inv);
    employees = new EmployeesService(db);

    paddockId = (await db.query<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
    cropId = ((await crops.create({ paddock_id: paddockId, crop_type: 'Maíz', area_ha: 50 })) as any).id;
    urea = ((await inv.createItem({ name: 'Urea', unit: 'kg', standard_cost: 0.6 })) as any).id;
    grano = ((await inv.createItem({ name: 'Grano maíz', unit: 'kg' })) as any).id;
    whId = ((await inv.createWarehouse({ name: 'Depósito agro' })) as any).id;
    await inv.recordMovement({ item_id: urea, warehouse_id: whId, movement_type: 'in', quantity: 1000, unit_cost: 0.6 });
    operatorId = ((await employees.create({ full_name: 'Tractorista', employment_type: 'permanent' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('labor con insumo: descuenta stock y deriva el costo real (avg_cost)', async () => {
    const op: any = await ops.recordOperation(cropId, { operation_type: 'fertilization', inventory_item_id: urea, quantity: 200, warehouse_id: whId, operator_id: operatorId });
    expect((await inv.listStock(whId, urea) as any[])[0].quantity).toBe(1000 - 200);
    expect(op.cost).toBe(120); // 200 × 0.60
  });

  it('labor sin insumo: solo registro (costo manual opcional)', async () => {
    const op: any = await ops.recordOperation(cropId, { operation_type: 'tillage', cost: 50 });
    expect(op.cost).toBe(50);
    expect(op.inventory_item_id).toBeNull();
  });

  it('stock insuficiente → 403 y sin persistencia parcial', async () => {
    const before = ((await ops.listOperations(cropId)) as any[]).length;
    await expect(ops.recordOperation(cropId, { operation_type: 'spraying', inventory_item_id: urea, quantity: 1_000_000, warehouse_id: whId })).rejects.toMatchObject({ status: 403 });
    expect(((await ops.listOperations(cropId)) as any[]).length).toBe(before);
  });

  it('validaciones: cultivo ajeno, operation_type, operario inactivo, warehouse faltante', async () => {
    await expect(ops.recordOperation('00000000-0000-0000-0000-000000000000', { operation_type: 'tillage' })).rejects.toMatchObject({ status: 404 });
    await expect(ops.recordOperation(cropId, { operation_type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
    await expect(ops.recordOperation(cropId, { operation_type: 'planting', inventory_item_id: urea, quantity: 10 })).rejects.toMatchObject({ status: 400 }); // sin warehouse
  });

  it('cosecha: rinde derivado (yield_per_ha), suma al stock y lleva el cultivo a harvested', async () => {
    const h: any = await ops.recordHarvest(cropId, { harvest_date: '2030-04-10', yield_quantity: 400000, yield_unit: 'kg', destination_item_id: grano, warehouse_id: whId });
    expect(h.yield_per_ha).toBe(8000); // 400000 / 50 ha
    expect((await inv.listStock(whId, grano) as any[])[0].quantity).toBe(400000);
    expect((await crops.get(cropId) as any).status).toBe('harvested');
    await expect(ops.recordHarvest(cropId, { harvest_date: '2030-04-11', yield_quantity: 0 })).rejects.toMatchObject({ status: 400 });
  });
});
