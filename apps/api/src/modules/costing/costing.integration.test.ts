import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BadRequestException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CostingService } from './costing.service';

/**
 * Integración de COSTOS POR CENTRO (G2 · E1). Se siembran hechos operativos con importes exactos en
 * cuatro módulos distintos y se comprueba que el motor los acumula en el centro correcto, respeta el
 * rango de fechas y NO cuenta dos veces (el stock que respalda el hecho no se suma aparte).
 */
describe('costing — costos por centro', () => {
  let db: DbService;
  let svc: CostingService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let lotId: string;
  let otherLotId: string;
  let animalId: string;
  let cropId: string;
  let machineryId: string;

  // Todos los hechos "dentro de rango" caen en febrero de 2030; los de control, en 2029.
  const IN = '2030-02-10';
  const OUT = '2029-02-10';
  const RANGE = { from: '2030-01-01', to: '2030-12-31' };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'costing-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new CostingService(db);
    tenantId = db.tenant;

    const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p))[0].id;
    farmId = await one(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]);
    speciesId = await one(`SELECT id FROM species LIMIT 1`);
    lotId = await one(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Costos') RETURNING id`, [tenantId, farmId]);
    otherLotId = await one(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Sin Costos') RETURNING id`, [tenantId, farmId]);
    animalId = await one(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, current_lot_id, status) VALUES ($1,$2,$3,'M',$4,'active') RETURNING id`,
      [tenantId, farmId, speciesId, lotId],
    );
    const paddockId = await one(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,'Potrero Maíz') RETURNING id`, [tenantId, farmId]);
    cropId = await one(
      `INSERT INTO crops (tenant_id, paddock_id, crop_type, variety, planting_date) VALUES ($1,$2,'maiz','DK72','2030-01-05') RETURNING id`,
      [tenantId, paddockId],
    );
    machineryId = await one(`INSERT INTO machinery (tenant_id, farm_id, name, type) VALUES ($1,$2,'Tractor 1','tractor') RETURNING id`, [tenantId, farmId]);

    // SANIDAD: 100 + 50 en rango sobre el animal (→ también al lote actual); 999 fuera de rango.
    const tr = (at: string, cost: number) =>
      db.query(`INSERT INTO treatments (tenant_id, animal_id, applied_at, cost) VALUES ($1,$2,$3,$4)`, [tenantId, animalId, at, cost]);
    await tr(IN, 100);
    await tr(IN, 50);
    await tr(OUT, 999);
    // NUTRICIÓN: 200 al lote en rango, 888 fuera.
    const fd = (at: string, cost: number) =>
      db.query(`INSERT INTO feed_deliveries (tenant_id, lot_id, delivered_at, quantity_kg, total_cost) VALUES ($1,$2,$3,500,$4)`, [tenantId, lotId, at, cost]);
    await fd(IN, 200);
    await fd(OUT, 888);
    // AGRICULTURA: 300 + 25 al cultivo en rango.
    const co = (at: string, cost: number) =>
      db.query(`INSERT INTO crop_operations (tenant_id, crop_id, operation_type, performed_at, cost) VALUES ($1,$2,'fertilization',$3,$4)`, [tenantId, cropId, at, cost]);
    await co(IN, 300);
    await co(IN, 25);
    await co(OUT, 777);
    // MAQUINARIA: combustible 400 + mantenimiento 60 en rango.
    await db.query(`INSERT INTO fuel_logs (tenant_id, machinery_id, fueled_at, liters, total_cost) VALUES ($1,$2,$3,120,400)`, [tenantId, machineryId, IN]);
    await db.query(`INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, cost) VALUES ($1,$2,'preventive',$3,60)`, [tenantId, machineryId, IN]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('acumula sanidad y nutrición en el lote, y deja fuera lo que cae fuera del rango', async () => {
    const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
    const row = res.rows.find((r) => r.reference_id === lotId)!;
    expect(row.categories.health).toBe(150); // 100 + 50 (los 999 de 2029 quedan afuera)
    expect(row.categories.feed).toBe(200); // los 888 de 2029 quedan afuera
    expect(row.total).toBe(350);
    // Categorías que no aplican al nivel siguen presentes en 0: la forma de la respuesta es estable.
    expect(row.categories.crop).toBe(0);
    expect(row.categories.machinery).toBe(0);
  });

  it('un lote sin hechos operativos aparece con costo 0 (no desaparece del listado)', async () => {
    const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
    const row = res.rows.find((r) => r.reference_id === otherLotId)!;
    expect(row).toBeDefined();
    expect(row.total).toBe(0);
  });

  it('a nivel animal la imputación de sanidad es exacta y solo lista animales con costo', async () => {
    const res = await svc.costsByCenter({ level: 'animal', ...RANGE });
    const row = res.rows.find((r) => r.reference_id === animalId)!;
    expect(row.categories.health).toBe(150);
    // El seed demo tiene muchos animales; solo aparecen los que tuvieron costo en el período.
    expect(res.rows.every((r) => r.total > 0)).toBe(true);
  });

  it('acumula labores en el cultivo, con nombre compuesto (crops no tiene columna de nombre)', async () => {
    const res = await svc.costsByCenter({ level: 'crop', ...RANGE });
    const row = res.rows.find((r) => r.reference_id === cropId)!;
    expect(row.categories.crop).toBe(325); // 300 + 25
    expect(row.name).toContain('maiz');
    expect(row.name).toContain('Potrero Maíz');
  });

  it('suma combustible y mantenimiento en la misma categoría de maquinaria', async () => {
    const res = await svc.costsByCenter({ level: 'machinery', ...RANGE });
    const row = res.rows.find((r) => r.reference_id === machineryId)!;
    expect(row.categories.machinery).toBe(460); // 400 combustible + 60 mantenimiento
  });

  it('los totales cierran con la suma de las filas y ordena de mayor a menor', async () => {
    const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
    const sum = res.rows.reduce((a, r) => a + r.total, 0);
    expect(res.totals.total).toBeCloseTo(sum, 2);
    expect(res.totals.by_category.health).toBeCloseTo(res.rows.reduce((a, r) => a + r.categories.health, 0), 2);
    const totals = res.rows.map((r) => r.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('el centro de costo es opcional: sin fila en cost_centers la entidad igual aparece, y con fila se vincula', async () => {
    const before = await svc.costsByCenter({ level: 'lot', ...RANGE });
    expect(before.rows.find((r) => r.reference_id === lotId)!.cost_center_id).toBeNull();

    const companyId = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const ccId = (
      await db.query<{ id: string }>(
        `INSERT INTO cost_centers (tenant_id, company_id, name, level, reference_id) VALUES ($1,$2,'CC Lote Costos','lot',$3) RETURNING id`,
        [tenantId, companyId, lotId],
      )
    )[0].id;

    const after = await svc.costsByCenter({ level: 'lot', ...RANGE });
    const row = after.rows.find((r) => r.reference_id === lotId)!;
    expect(row.cost_center_id).toBe(ccId);
    expect(row.total).toBe(350); // vincular un centro no cambia el costo
  });

  it('rechaza nivel inválido y rango invertido', async () => {
    // El contrato de error del repo es el `code` del cuerpo, no el mensaje (que Nest generaliza).
    const codeOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        return ((e as BadRequestException).getResponse() as { code?: string }).code ?? null;
      }
    };
    expect(await codeOf(svc.costsByCenter({ level: 'finca' as never }))).toBe('costing.invalid_level');
    expect(await codeOf(svc.costsByCenter({ from: '2030-12-31', to: '2030-01-01' }))).toBe('costing.inverted_range');
    expect(await codeOf(svc.costsByCenter({ from: 'ayer' }))).toBe('costing.invalid_range');
  });
});
