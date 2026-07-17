import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { HealthService } from './health.service';
import { TreatmentService } from './treatment.service';
import { VaccinationService } from './vaccination.service';
import { InventoryService } from '../inventory/inventory.service';
import type { MortalityService } from './mortality.service';

/**
 * Sanidad E5 — inventario de medicamentos + costos. Al aplicar un producto ENLAZADO a un ítem de
 * inventario se descuenta stock (regla única de inventario) y se fija el costo REAL (dosis × avg_cost);
 * el stock insuficiente aborta la aplicación (atómico); y hay reportes de costo/consumo + alertas de
 * stock bajo/vencido.
 */
describe('HealthService — inventario de medicamentos + costos (E5)', () => {
  let db: DbService;
  let health: HealthService;
  let inventory: InventoryService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let itemId: string;
  let warehouseId: string;
  let vaccineId: string;
  let lotA: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `HI-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'health-inv-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inventory = new InventoryService(db);
    health = new HealthService(db, {} as MortalityService, new TreatmentService(db), new VaccinationService(db), inventory);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    itemId = (await db.query<{ id: string }>(`INSERT INTO inventory_items (tenant_id, name, unit, reorder_point, created_by) VALUES ($1,'Vacuna Aftosa (frasco)','un',10,$2) RETURNING id`, [tenantId, userId]))[0].id;
    warehouseId = (await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, farm_id, name, created_by) VALUES ($1,$2,'Botiquín',$3) RETURNING id`, [tenantId, farmId, userId]))[0].id;
    // Carga inicial de stock: 100 dosis a $10 c/u.
    await inventory.recordMovement({ item_id: itemId, warehouse_id: warehouseId, movement_type: 'in', quantity: 100, unit_cost: 10 });
    vaccineId = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, inventory_item_id, created_by) VALUES ($1,'Aftosa Inv','vaccine',$2,$3) RETURNING id`, [tenantId, itemId, userId]))[0].id;
    lotA = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, uniq('LOTE'), userId]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(lot: string | null): Promise<string> {
    return (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'F','active','born',$4) RETURNING id`,
      [tenantId, farmId, speciesId, lot],
    ))[0].id;
  }
  const stock = async () => (await db.query<any>(`SELECT sum(quantity)::float AS q FROM stock_levels WHERE item_id=$1`, [itemId]))[0].q;
  const vaccCost = async (id: string) => (await db.query<any>(`SELECT cost::float AS cost FROM vaccinations WHERE id=$1`, [id]))[0]?.cost;

  it('aplicar vacuna enlazada descuenta stock y fija el costo real (dosis × avg_cost)', async () => {
    const a = await animal(lotA);
    const before = await stock();
    const res: any = await health.vaccinate({ animal_id: a, product_id: vaccineId, dose: 2 }, randomUUID());
    expect(await stock()).toBe(before - 2); // 2 dosis consumidas
    const vid = res.results[0].vaccinationId;
    expect(await vaccCost(vid)).toBe(20); // 2 × $10
  });

  it('vacunación masiva descuenta por cada aplicación', async () => {
    const a1 = await animal(lotA);
    const a2 = await animal(lotA);
    const before = await stock();
    const r: any = await health.vaccinateMass({ scope: 'lot', lot_id: lotA, product_id: vaccineId, dose: 3 }, randomUUID());
    // aplica a los del lote que aún no tienen esta aplicación (la del test anterior ya está)
    expect(await stock()).toBe(before - 3 * r.applied);
    expect(r.applied).toBeGreaterThanOrEqual(2);
  });

  it('stock insuficiente aborta la aplicación (atómico) → 403 sin descontar', async () => {
    const a = await animal(null);
    const before = await stock();
    await expect(health.vaccinate({ animal_id: a, product_id: vaccineId, dose: 999 }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'inventory.insufficient_stock' } });
    expect(await stock()).toBe(before); // nada consumido
  });

  it('reporte de consumo por producto: cantidad y costo', async () => {
    const rows: any[] = await health.consumption({});
    const row = rows.find((r) => r.product_id === vaccineId);
    expect(row).toBeTruthy();
    expect(row.quantity).toBeGreaterThan(0);
    expect(row.cost).toBeGreaterThan(0);
  });

  it('reporte de costo sanitario por lote', async () => {
    const rows: any[] = await health.costs({ by: 'lot' });
    const row = rows.find((r) => r.lot_id === lotA);
    expect(row).toBeTruthy();
    expect(row.cost).toBeGreaterThan(0);
  });

  it('alertas de stock: producto por debajo del punto de reorden', async () => {
    // consumir hasta dejar el stock ≤ reorder_point (10)
    const st = await stock();
    if (st > 10) await inventory.recordMovement({ item_id: itemId, warehouse_id: warehouseId, movement_type: 'consumption', quantity: -(st - 5) });
    const alerts: any[] = await health.stockAlerts();
    const row = alerts.find((a) => a.product_id === vaccineId);
    expect(row).toBeTruthy();
    expect(row.is_low).toBe(true);
  });

  it('vademécum expone stock y bandera de stock bajo', async () => {
    const prods: any[] = await health.products();
    const row = prods.find((p) => p.id === vaccineId);
    expect(row.inventory_item_id).toBe(itemId);
    expect(row.stock).not.toBeNull();
    expect(row.is_low).toBe(true);
  });
});
