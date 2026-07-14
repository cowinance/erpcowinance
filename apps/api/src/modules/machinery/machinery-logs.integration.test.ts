import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { EmployeesService } from '../hr/employees.service';
import { MachineryService } from './machinery.service';
import { MachineryLogsService } from './machinery-logs.service';

/**
 * Integración de mantenimiento + combustible (MQ-2): consumo de combustible con costo real, lecturas
 * del maestro y validaciones. `db.tenant` cae al demo.
 */
describe('machinery — mantenimiento y combustible', () => {
  let db: DbService;
  let inv: InventoryService;
  let machinery: MachineryService;
  let logs: MachineryLogsService;
  let employees: EmployeesService;
  let originalCwd: string;
  let tmp: string;
  let machineId: string;
  let gasoil: string;
  let whId: string;
  let operatorId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'machlogs-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    machinery = new MachineryService(db);
    logs = new MachineryLogsService(db, inv);
    employees = new EmployeesService(db);

    machineId = ((await machinery.create({ name: 'Tractor MQ2', type: 'tractor', engine_hours: 1000 })) as any).id;
    gasoil = ((await inv.createItem({ name: 'Gasoil', unit: 'l', standard_cost: 1.2 })) as any).id;
    whId = ((await inv.createWarehouse({ name: 'Tanque combustible' })) as any).id;
    await inv.recordMovement({ item_id: gasoil, warehouse_id: whId, movement_type: 'in', quantity: 5000, unit_cost: 1.2 });
    operatorId = ((await employees.create({ full_name: 'Chofer', employment_type: 'permanent' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('mantenimiento: registra el evento y actualiza engine_hours del maestro', async () => {
    const rec: any = await logs.recordMaintenance(machineId, { type: 'preventive', description: 'Cambio de aceite', engine_hours: 1050, cost: 300, next_due_date: '2030-12-01' });
    expect(rec.type).toBe('preventive');
    expect(rec.cost).toBe(300);
    expect((await machinery.get(machineId) as any).engine_hours).toBe(1050);
    await expect(logs.recordMaintenance(machineId, { type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('combustible con ítem: descuenta stock, deriva total_cost real y actualiza odómetro', async () => {
    const log: any = await logs.recordFuel(machineId, { item_id: gasoil, warehouse_id: whId, liters: 200, odometer_km: 45000, operator_id: operatorId });
    expect((await inv.listStock(whId, gasoil) as any[])[0].quantity).toBe(5000 - 200);
    expect(log.total_cost).toBe(240); // 200 × 1.20
    expect((await machinery.get(machineId) as any).odometer_km).toBe(45000);
  });

  it('combustible sin ítem: total_cost manual (liters × unit_cost)', async () => {
    const log: any = await logs.recordFuel(machineId, { liters: 100, unit_cost: 1.5 });
    expect(log.total_cost).toBe(150);
    expect(log.item_id).toBeNull();
  });

  it('stock insuficiente → 403 y rollback; validaciones (máquina, litros, operario, warehouse)', async () => {
    const before = ((await logs.listFuel(machineId)) as any[]).length;
    await expect(logs.recordFuel(machineId, { item_id: gasoil, warehouse_id: whId, liters: 1_000_000 })).rejects.toMatchObject({ status: 403 });
    expect(((await logs.listFuel(machineId)) as any[]).length).toBe(before);
    await expect(logs.recordFuel('00000000-0000-0000-0000-000000000000', { liters: 10 })).rejects.toMatchObject({ status: 404 });
    await expect(logs.recordFuel(machineId, { liters: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(logs.recordFuel(machineId, { item_id: gasoil, liters: 10 })).rejects.toMatchObject({ status: 400 }); // sin warehouse
  });
});
