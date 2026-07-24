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
  let dairyLotId: string;

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
      `INSERT INTO crops (tenant_id, paddock_id, crop_type, variety, planting_date, area_ha) VALUES ($1,$2,'maiz','DK72','2030-01-05',10) RETURNING id`,
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

    // ── E2 · producción, para que los costos se vuelvan unitarios ──────────────────────────────
    // CARNE: el animal pasa de 400 a 460 kg dentro del rango → 60 kg producidos.
    await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,'2030-01-15',400),($1,$2,'2030-06-15',460)`, [tenantId, animalId]);
    // LECHE: lote 'dairy' aparte, con su propio costo (90 sanidad + 210 ración = 300) y 200 litros.
    dairyLotId = await one(`INSERT INTO lots (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Tambo','dairy') RETURNING id`, [tenantId, farmId]);
    const cowId = await one(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, current_lot_id, status) VALUES ($1,$2,$3,'F',$4,'active') RETURNING id`,
      [tenantId, farmId, speciesId, dairyLotId],
    );
    await db.query(`INSERT INTO treatments (tenant_id, animal_id, applied_at, cost) VALUES ($1,$2,$3,90)`, [tenantId, cowId, IN]);
    await db.query(`INSERT INTO feed_deliveries (tenant_id, lot_id, delivered_at, quantity_kg, total_cost) VALUES ($1,$2,$3,300,210)`, [tenantId, dairyLotId, IN]);
    await db.query(
      `INSERT INTO milk_production_daily (tenant_id, animal_id, production_date, total_liters) VALUES ($1,$2,'2030-02-10',120),($1,$2,'2030-02-11',80)`,
      [tenantId, cowId],
    );
    // AGRICULTURA: 6500 kg cosechados sobre 10 ha (labores por 325 ya sembradas arriba).
    await db.query(
      `INSERT INTO harvests (tenant_id, crop_id, harvest_date, yield_quantity, yield_unit, yield_per_ha) VALUES ($1,$2,'2030-05-01',6500,'kg',650)`,
      [tenantId, cropId],
    );
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

  // ── E2 · costo unitario por actividad ────────────────────────────────────────────────────────
  // El rango 2030 aísla la fixture: el seed demo genera datos alrededor de hoy, no en 2030.

  describe('costo unitario por actividad (E2)', () => {
    const activityOf = async (kind: string) =>
      (await svc.unitCosts(RANGE)).activities.find((a) => a.activity === kind)!;

    it('carne: divide el costo del rodeo por los kilos efectivamente producidos', async () => {
      const beef = await activityOf('beef');
      expect(beef.cost).toBe(350); // 150 sanidad + 200 ración (el lote 'dairy' no entra)
      expect(beef.output).toBe(60); // 460 − 400 dentro del rango
      expect(beef.unit_cost).toBe(5.83); // 350 / 60
      expect(beef.output_unit).toBe('kg ganados');
      expect(beef.note).toBeNull();
    });

    it('leche: el costo del tambo se separa por el propósito del lote', async () => {
      const milk = await activityOf('milk');
      expect(milk.cost).toBe(300); // 90 sanidad + 210 ración, solo del lote 'dairy'
      expect(milk.output).toBe(200); // 120 + 80 litros
      expect(milk.unit_cost).toBe(1.5);
      expect(milk.detail.lots).toBe(1);
      expect(milk.detail.head).toBe(1);
    });

    it('agricultura: informa costo por kg cosechado Y por hectárea', async () => {
      const crop = await activityOf('crop');
      expect(crop.cost).toBe(325);
      expect(crop.output).toBe(6500);
      expect(crop.output_unit).toBe('kg'); // la unidad sale de harvests.yield_unit
      expect(crop.unit_cost).toBe(0.05); // 325 / 6500
      expect(crop.cost_per_ha).toBe(32.5); // 325 / 10 ha
    });

    it('las actividades no se pisan: el costo del tambo no se cuenta también como carne', async () => {
      const { activities } = await svc.unitCosts(RANGE);
      const total = activities.reduce((a, x) => a + x.cost, 0);
      expect(total).toBe(975); // 350 carne + 300 leche + 325 agricultura, sin solapamiento
    });

    it('un período sin producción no devuelve costo unitario cero, sino null con explicación', async () => {
      // 2029 tiene costos cargados (los de control) pero ninguna producción medida.
      const res = await svc.unitCosts({ from: '2029-01-01', to: '2029-12-31' });
      const beef = res.activities.find((a) => a.activity === 'beef')!;
      expect(beef.cost).toBeGreaterThan(0);
      expect(beef.output).toBe(0);
      expect(beef.unit_cost).toBeNull(); // cero lo ordenaría como el más eficiente
      expect(beef.note).toMatch(/pesajes/);
    });

    it('avisa cuando hay leche pero ningún lote marcado como tambo (costo imposible de separar)', async () => {
      // Se saca el propósito 'dairy': la leche sigue existiendo, el costo ya no se puede aislar.
      await db.query(`UPDATE lots SET purpose='breeding' WHERE id=$1`, [dairyLotId]);
      const res = await svc.unitCosts(RANGE);
      const milk = res.activities.find((a) => a.activity === 'milk')!;
      expect(milk.output).toBe(200);
      expect(milk.cost).toBe(0);
      expect(milk.unit_cost).toBeNull();
      expect(milk.note).toMatch(/tambo/);
      await db.query(`UPDATE lots SET purpose='dairy' WHERE id=$1`, [dairyLotId]);
    });

    it('el rango inválido se rechaza igual que en costos por centro (misma guarda)', async () => {
      await expect(svc.unitCosts({ from: '2030-12-31', to: '2030-01-01' })).rejects.toThrow();
    });
  });
});
