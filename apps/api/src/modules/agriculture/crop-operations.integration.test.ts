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

  /**
   * Rinde y costo por hectárea (Fase 4). Lo que se fija acá es que el rinde se DERIVE: la tabla
   * guarda `yield_per_ha` y un reporte que lea esa columna daría el número escrito una vez, no el
   * que se desprende de la cosecha y la superficie que están al lado.
   */
  describe('rinde por hectárea (Fase 4)', () => {
    const R = { from: '2037-01-01', to: '2037-12-31' };
    let bueno: string;
    let flojo: string;
    let enPie: string;

    const labor = (crop: string, costo: number, fecha = '2037-03-01') =>
      db.query(`INSERT INTO crop_operations (tenant_id, crop_id, operation_type, performed_at, cost) VALUES ($1,$2,'fertilization',$3,$4)`, [db.tenant, crop, `${fecha}T10:00:00Z`, costo]);
    const cosecha = (crop: string, kg: number, yieldPerHaGuardado: number, item: string | null = null) =>
      db.query(
        `INSERT INTO harvests (tenant_id, crop_id, harvest_date, yield_quantity, yield_unit, yield_per_ha, destination_item_id) VALUES ($1,$2,'2037-06-01',$3,'kg',$4,$5)`,
        [db.tenant, crop, kg, yieldPerHaGuardado, item],
      );

    beforeAll(async () => {
      const nuevo = async (ha: number) => ((await crops.create({ paddock_id: paddockId, crop_type: 'trigo', area_ha: ha })) as any).id as string;
      bueno = await nuevo(100);
      flojo = await nuevo(100);
      enPie = await nuevo(50);

      // La columna guardada dice 999: si el reporte la leyera, el rinde saldría de ahí.
      await cosecha(bueno, 400000, 999, grano);
      await labor(bueno, 20000);
      await cosecha(flojo, 200000, 999);
      await labor(flojo, 20000);
      await labor(enPie, 8000); // sembrado y sin cosechar
    });

    it('EL RINDE SE DERIVA, NO SE LEE DE LA COLUMNA GUARDADA', async () => {
      const r: any = await crops.yields(R);
      const c = r.crops.find((x: any) => x.cropId === bueno);
      expect(c.yieldPerHa).toBe(4000); // 400.000 / 100 ha, no los 999 guardados
    });

    it('compara contra los lotes del MISMO cultivo', async () => {
      const r: any = await crops.yields(R);
      expect(r.crops.find((x: any) => x.cropId === bueno).yieldIndex).toBeGreaterThan(100);
      expect(r.crops.find((x: any) => x.cropId === flojo).yieldIndex).toBeLessThan(100);
    });

    it('el lote en pie tiene costo por hectárea y NO rinde', async () => {
      // Distinguirlo de uno que rindió mal es la diferencia entre «esperar» y «cambiar algo».
      const r: any = await crops.yields(R);
      const c = r.crops.find((x: any) => x.cropId === enPie);
      expect(c.costPerHa).toBe(160);
      expect(c.yieldPerHa).toBeNull();
      expect(c.yieldIndex).toBeNull();
    });

    it('SIN VENTA DEL GRANO NO HAY MARGEN INVENTADO', async () => {
      // El precio sale de ventas reales. Un margen sobre un precio supuesto se ve igual de
      // convincente que uno real, y sobre eso alguien decide qué sembrar el año que viene.
      const r: any = await crops.yields(R);
      expect(r.crops.find((x: any) => x.cropId === bueno).margin).toBeNull();
      expect(r.crops.find((x: any) => x.cropId === bueno).price_used).toBeNull();
    });

    it('con la venta del grano aparece el margen, al precio que se cobró', async () => {
      const [{ id: cliente }] = await db.query<any>(
        `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,(SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1),'customer','Acopio test') RETURNING id`,
        [db.tenant],
      );
      await db.query(`INSERT INTO customers (tenant_id, partner_id) VALUES ($1,$2)`, [db.tenant, cliente]);
      const [{ id: venta }] = await db.query<any>(
        `INSERT INTO sales (tenant_id, company_id, customer_partner_id, sale_date, type, currency, subtotal, tax_total, total, status)
         VALUES ($1,(SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1),$2,'2037-07-01','crop','USD',0,0,0,'delivered') RETURNING id`,
        [db.tenant, cliente],
      );
      await db.query(
        `INSERT INTO sale_lines (tenant_id, sale_id, item_id, quantity, unit_price, tax_rate, line_total) VALUES ($1,$2,$3,400000,0.2,0,80000)`,
        [db.tenant, venta, grano],
      );

      const r: any = await crops.yields(R);
      const c = r.crops.find((x: any) => x.cropId === bueno);
      expect(c.price_used).toBe(0.2);
      expect(c.revenue).toBe(80000); // 400.000 × 0,2
      expect(c.margin).toBe(60000); // − 20.000 de labores
      // El lote sin ítem destino sigue sin margen: la venta no le corresponde.
      expect(r.crops.find((x: any) => x.cropId === flojo).margin).toBeNull();
    });
  });
});
