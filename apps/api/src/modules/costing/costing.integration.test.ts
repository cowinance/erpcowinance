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
  let looseAnimalId: string;
  let budgetId: string;
  let laborLotId: string;
  let taskLotId: string;
  let pricedEmployeeId: string;

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

    // ── E3 · ingresos, para que el costo se vuelva margen ──────────────────────────────────────
    const companyId = await one(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [tenantId]);
    const customerId = await one(
      `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'customer','Frigorífico Test') RETURNING id`,
      [tenantId, companyId],
    );
    const mkSale = async (type: string, total: number, status = 'confirmed', date = '2030-07-01') =>
      one(
        `INSERT INTO sales (tenant_id, company_id, customer_partner_id, sale_date, type, currency, subtotal, tax_total, total, status)
         VALUES ($1,$2,$3,$4,$5,'ARS',$6,0,$6,$7) RETURNING id`,
        [tenantId, companyId, customerId, date, type, total, status],
      );
    const mkLine = (saleId: string, animal: string, total: number) =>
      db.query(`INSERT INTO sale_lines (tenant_id, sale_id, animal_id, quantity, unit_price, line_total) VALUES ($1,$2,$3,1,$4,$4)`, [tenantId, saleId, animal, total]);

    // Venta que SÍ cuenta: hacienda por 900 del animal del lote.
    await mkLine(await mkSale('livestock', 900), animalId, 900);
    // Borrador y anulada por el mismo animal: NO cuentan como ingreso.
    await mkLine(await mkSale('livestock', 500, 'draft'), animalId, 500);
    await mkLine(await mkSale('livestock', 700, 'canceled'), animalId, 700);
    // Animal vendido que ya no pertenece a ningún lote: su ingreso no puede desaparecer.
    looseAnimalId = await one(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'M','sold') RETURNING id`,
      [tenantId, farmId, speciesId],
    );
    await mkLine(await mkSale('livestock', 120), looseAnimalId, 120);
    // LECHE: una venta facturada (250) + remisión sin facturar (200 L × $2 = 400). La remisión que
    // YA tiene venta asociada no se cuenta de nuevo.
    const milkSaleId = await mkSale('milk', 250);
    await db.query(`INSERT INTO milk_deliveries (tenant_id, delivered_at, liters, price_per_liter) VALUES ($1,'2030-03-01',200,2)`, [tenantId]);
    await db.query(`INSERT INTO milk_deliveries (tenant_id, delivered_at, liters, price_per_liter, sale_id) VALUES ($1,'2030-03-02',999,2,$2)`, [tenantId, milkSaleId]);
    // AGRICULTURA: venta de grano por 5000.
    await mkSale('crop', 5000);

    // ── E4 · presupuesto, para comparar contra el gasto operativo ──────────────────────────────
    // Un centro de costo para el lote costeado y otro para un lote sin gasto (arranca en 0).
    const ccLot = await one(
      `INSERT INTO cost_centers (tenant_id, company_id, name, level, reference_id) VALUES ($1,$2,'CC Lote','lot',$3) RETURNING id`,
      [tenantId, companyId, lotId],
    );
    const ccIdle = await one(
      `INSERT INTO cost_centers (tenant_id, company_id, name, level, reference_id) VALUES ($1,$2,'CC Sin Gasto','lot',$3) RETURNING id`,
      [tenantId, companyId, otherLotId],
    );
    // Una cuenta cualquiera de gasto (el tipo no importa acá: el costo operativo es siempre gasto).
    const acctId = await one(
      `INSERT INTO chart_of_accounts (tenant_id, company_id, code, name, type) VALUES ($1,$2,'5.1.99','Gastos operativos test','expense') RETURNING id`,
      [tenantId, companyId],
    );
    budgetId = await one(
      `INSERT INTO budgets (tenant_id, company_id, name, fiscal_year, status) VALUES ($1,$2,'Presupuesto 2030',2030,'approved') RETURNING id`,
      [tenantId, companyId],
    );
    const mkBudgetLine = (cc: string, month: number, amount: number) =>
      db.query(`INSERT INTO budget_lines (tenant_id, budget_id, account_id, cost_center_id, month, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, budgetId, acctId, cc, month, amount]);
    // Lote costeado: presupuesto 300 (feb) → gasto real 350 ⇒ sobregiro de 50.
    await mkBudgetLine(ccLot, 2, 300);
    // Lote sin gasto: presupuesto 500 (marzo) → real 0 ⇒ bajo presupuesto (todavía no arrancó).
    await mkBudgetLine(ccIdle, 3, 500);

    // ── E6 · mano de obra ──────────────────────────────────────────────────────────────────────
    // Lotes propios: así las aserciones de E1/E4 sobre los lotes anteriores siguen valiendo.
    laborLotId = await one(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Jornales') RETURNING id`, [tenantId, farmId]);
    taskLotId = await one(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Por Tarea') RETURNING id`, [tenantId, farmId]);
    const ccLabor = await one(
      `INSERT INTO cost_centers (tenant_id, company_id, name, level, reference_id) VALUES ($1,$2,'CC Jornales','lot',$3) RETURNING id`,
      [tenantId, companyId, laborLotId],
    );
    // Un empleado CON tarifa ($100/h) y otro SIN: el segundo prueba que no se cuenta como gratis.
    pricedEmployeeId = await one(
      `INSERT INTO employees (tenant_id, company_id, full_name, hourly_rate) VALUES ($1,$2,'Juan Peón',100) RETURNING id`,
      [tenantId, companyId],
    );
    const unpricedEmp = await one(
      `INSERT INTO employees (tenant_id, company_id, full_name) VALUES ($1,$2,'Sin Tarifa') RETURNING id`,
      [tenantId, companyId],
    );
    // Tarea vinculada a un lote: habilita la imputación DERIVADA (sin cost_center_id).
    const lotTaskId = await one(
      `INSERT INTO tasks (tenant_id, farm_id, title, related_type, related_id) VALUES ($1,$2,'Arreglo de alambrado','lot',$3) RETURNING id`,
      [tenantId, farmId, taskLotId],
    );
    const mkLog = (emp: string, hours: number, extra: { cc?: string; task?: string } = {}) =>
      db.query(`INSERT INTO work_logs (tenant_id, employee_id, work_date, hours, cost_center_id, task_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, emp, IN, hours, extra.cc ?? null, extra.task ?? null]);
    await mkLog(pricedEmployeeId, 8, { cc: ccLabor }); // explícito → 800 al lote de jornales
    await mkLog(pricedEmployeeId, 5, { task: lotTaskId }); // derivado de la tarea → 500
    await mkLog(pricedEmployeeId, 3); // sin imputar → 300 sin atribuir
    await mkLog(unpricedEmp, 10); // 10 horas que el sistema NO puede valorizar
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
    // Lote propio del test: los del fixture ya tienen centro de costo (los usa E4).
    const companyId = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const freshLot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote Sin CC') RETURNING id`, [tenantId, farmId]))[0].id;

    const before = await svc.costsByCenter({ level: 'lot', ...RANGE });
    expect(before.rows.find((r) => r.reference_id === freshLot)!.cost_center_id).toBeNull();

    const ccId = (
      await db.query<{ id: string }>(
        `INSERT INTO cost_centers (tenant_id, company_id, name, level, reference_id) VALUES ($1,$2,'CC Fresh','lot',$3) RETURNING id`,
        [tenantId, companyId, freshLot],
      )
    )[0].id;

    const after = await svc.costsByCenter({ level: 'lot', ...RANGE });
    const row = after.rows.find((r) => r.reference_id === freshLot)!;
    expect(row.cost_center_id).toBe(ccId);
    expect(row.total).toBe(0); // el lote fresco no tiene gasto; vincular un centro no lo cambia
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
      // 150 sanidad + 200 ración + 1300 de mano de obra imputada a lotes de carne (E6).
      // El lote 'dairy' no entra: su costo es de leche.
      expect(beef.cost).toBe(1650);
      expect(beef.output).toBe(60); // 460 − 400 dentro del rango
      expect(beef.unit_cost).toBe(27.5); // 1650 / 60
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
      // 1650 carne (incl. jornales) + 300 leche + 325 agricultura, sin solapamiento.
      expect(total).toBe(2275)
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

  // ── E3 · rentabilidad ────────────────────────────────────────────────────────────────────────

  describe('rentabilidad (E3)', () => {
    it('lote: margen = ingresos de los animales del lote menos sus costos', async () => {
      const res = await svc.profitability({ level: 'lot', ...RANGE });
      const row = res.rows.find((r) => r.reference_id === lotId)!;
      expect(row.revenue).toBe(900); // solo la venta confirmada
      expect(row.cost).toBe(350);
      expect(row.margin).toBe(550);
      expect(row.margin_pct).toBe(61.11); // 550 / 900
      expect(row.roi_pct).toBe(157.14); // 550 / 350
    });

    it('el borrador y la anulada no son ingreso (regla SALE_COUNTS de Comercial)', async () => {
      const res = await svc.profitability({ level: 'animal', ...RANGE });
      const row = res.rows.find((r) => r.reference_id === animalId)!;
      expect(row.revenue).toBe(900); // no 900+500+700
      expect(row.cost).toBe(150);
      expect(row.margin).toBe(750);
    });

    it('un lote con costos y sin ventas no figura con −100%: la hacienda está en pie', async () => {
      const res = await svc.profitability({ level: 'lot', ...RANGE });
      const row = res.rows.find((r) => r.reference_id === dairyLotId)!;
      expect(row.revenue).toBe(0);
      expect(row.margin).toBe(-300);
      expect(row.margin_pct).toBeNull();
      expect(row.roi_pct).toBe(-100);
    });

    it('las ventas de animales sin lote se muestran aparte, no se descartan', async () => {
      const res = await svc.profitability({ level: 'lot', ...RANGE });
      const loose = res.rows.find((r) => r.reference_id === null)!;
      expect(loose.name).toMatch(/Sin lote/);
      expect(loose.revenue).toBe(120);
      // Y por eso el total cierra con TODAS las ventas de hacienda del período, no solo las que
      // siguen teniendo lote. (Leche y grano no se atribuyen a un lote: se ven por actividad.)
      expect(res.totals.revenue).toBe(1020); // 900 + 120
    });

    it('actividad: cruza ingresos por tipo de venta con los costos y la producción de E2', async () => {
      const res = await svc.profitability({ level: 'activity', ...RANGE });
      const beef = res.rows.find((r) => r.reference_id === 'beef')! as any;
      expect(beef.revenue).toBe(1020); // 900 + 120
      expect(beef.cost).toBe(1650); // incluye la mano de obra imputada (E6)
      expect(beef.margin).toBe(-630); // con los jornales contados, la carne da pérdida
      expect(beef.output).toBe(60);
      expect(beef.margin_per_unit).toBe(-10.5); // −630 / 60 kg producidos
    });

    it('leche: suma la remisión sin facturar y NO cuenta dos veces la que ya tiene venta', async () => {
      const res = await svc.profitability({ level: 'activity', ...RANGE });
      const milk = res.rows.find((r) => r.reference_id === 'milk')! as any;
      expect(milk.revenue).toBe(650); // 250 de la venta + 400 de la remisión sin facturar
      expect(milk.cost).toBe(300);
      expect(milk.margin).toBe(350);
    });

    it('ordena por margen: lo que más deja va primero', async () => {
      const res = await svc.profitability({ level: 'activity', ...RANGE });
      const margins = res.rows.map((r) => r.margin);
      expect([...margins].sort((a, b) => b - a)).toEqual(margins);
      expect(res.rows[0].reference_id).toBe('crop'); // 5000 − 325
    });

    it('rechaza un nivel que existe para costos pero no para rentabilidad', async () => {
      await expect(svc.profitability({ level: 'machinery' as never })).rejects.toThrow();
    });
  });

  // ── E4 · real vs presupuesto ─────────────────────────────────────────────────────────────────

  describe('real vs presupuesto (E4)', () => {
    it('cruza el gasto operativo con el presupuesto del centro y calcula el desvío', async () => {
      const res = await svc.budgetVsActual({ budgetId, level: 'lot' });
      expect(res.fiscal_year).toBe(2030);
      const row = res.rows.find((r) => r.reference_id === lotId)!;
      expect(row.budget).toBe(300);
      expect(row.actual).toBe(350); // el mismo total que E1
      expect(row.variance).toBe(50); // sobregiro
      expect(row.over_budget).toBe(true);
    });

    it('un centro presupuestado sin gasto todavía se ve (no desaparece), bajo presupuesto', async () => {
      const res = await svc.budgetVsActual({ budgetId, level: 'lot' });
      const row = res.rows.find((r) => r.reference_id === otherLotId)!;
      expect(row.budget).toBe(500);
      expect(row.actual).toBe(0);
      expect(row.variance).toBe(-500);
      expect(row.over_budget).toBe(false);
    });

    it('el gasto sin centro de costo no se pierde: suma en unbudgeted_actual', async () => {
      const res = await svc.budgetVsActual({ budgetId, level: 'lot' });
      // El dairyLot tiene gasto (300) pero ningún centro de costo asignado.
      expect(res.totals.unbudgeted_actual).toBeGreaterThan(0);
    });

    it('los totales resumen el año: presupuestado, real y desvío global', async () => {
      const res = await svc.budgetVsActual({ budgetId, level: 'lot' });
      expect(res.totals.budget).toBe(800); // 300 + 500
      expect(res.totals.actual).toBe(350); // solo los centros presupuestados
      expect(res.totals.variance).toBe(-450);
    });

    it('acotar el rango a un mes recorta el presupuesto a ese mes (los dos lados miran la misma ventana)', async () => {
      // Solo febrero: entra la línea del lote costeado (300), no la de marzo (500).
      const res = await svc.budgetVsActual({ budgetId, level: 'lot', from: '2030-02-01', to: '2030-02-28' });
      expect(res.totals.budget).toBe(300);
      expect(res.rows.find((r) => r.reference_id === otherLotId)).toBeUndefined();
    });

    it('ordena por peor desvío primero (lo que más se pasó va arriba)', async () => {
      const res = await svc.budgetVsActual({ budgetId, level: 'lot' });
      const vs = res.rows.map((r) => r.variance);
      expect([...vs].sort((a, b) => b - a)).toEqual(vs);
    });

    it('rechaza un presupuesto inexistente y un nivel inválido', async () => {
      await expect(svc.budgetVsActual({ budgetId: '00000000-0000-0000-0000-000000000000', level: 'lot' })).rejects.toThrow();
      await expect(svc.budgetVsActual({ budgetId, level: 'activity' as never })).rejects.toThrow();
    });
  });

  // ── E6 · costo de mano de obra ───────────────────────────────────────────────────────────────

  describe('mano de obra (E6)', () => {
    it('valoriza las horas a la tarifa del empleado e imputa por el centro de costo explícito', async () => {
      const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
      const row = res.rows.find((r) => r.reference_id === laborLotId)!;
      expect(row.categories.labor).toBe(800); // 8 h × $100
      expect(row.total).toBe(800);
    });

    it('sin centro explícito, deriva la imputación de la tarea vinculada', async () => {
      const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
      const row = res.rows.find((r) => r.reference_id === taskLotId)!;
      expect(row.categories.labor).toBe(500); // 5 h × $100, atribuidas por tasks.related_id
    });

    it('las horas de un empleado SIN tarifa no se cuentan como gratis: se informan aparte', async () => {
      const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
      expect(res.totals.unpriced_hours).toBe(10);
      // Y no inflan ninguna categoría: 800 + 500 imputadas, nada más.
      expect(res.totals.by_category.labor).toBe(1300);
    });

    it('la jornada sin centro ni tarea no se pierde: suma en unattributed_labor', async () => {
      const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
      expect(res.totals.unattributed_labor).toBe(300); // 3 h × $100
    });

    it('la mano de obra imputada entra en el costo unitario de la actividad', async () => {
      // Los 1300 imputados a lotes de carne se suman al costo del kilo producido.
      const res = await svc.unitCosts(RANGE);
      const beef = res.activities.find((a) => a.activity === 'beef')!;
      expect(beef.cost).toBe(1650); // 350 (sanidad+ración) + 1300 de jornales
    });

    it('no cuenta la misma jornada dos veces cuando tiene centro Y tarea', async () => {
      // El centro explícito gana; la tarea no agrega una segunda imputación.
      const ccExtra = (
        await db.query<{ id: string }>(
          `SELECT id FROM cost_centers WHERE tenant_id=$1 AND reference_id=$2 LIMIT 1`,
          [tenantId, laborLotId],
        )
      )[0].id;
      const taskId = (
        await db.query<{ id: string }>(
          `INSERT INTO tasks (tenant_id, farm_id, title, related_type, related_id) VALUES ($1,$2,'Doble','lot',$3) RETURNING id`,
          [tenantId, farmId, taskLotId],
        )
      )[0].id;
      await db.query(`INSERT INTO work_logs (tenant_id, employee_id, work_date, hours, cost_center_id, task_id) VALUES ($1,$2,$3,2,$4,$5)`,
        [tenantId, pricedEmployeeId, IN, ccExtra, taskId]);

      const res = await svc.costsByCenter({ level: 'lot', ...RANGE });
      const labor = res.rows.find((r) => r.reference_id === laborLotId)!.categories.labor;
      const byTask = res.rows.find((r) => r.reference_id === taskLotId)!.categories.labor;
      expect(labor).toBe(1000); // 800 + los 200 nuevos, al centro EXPLÍCITO
      expect(byTask).toBe(500); // la tarea no los duplica acá
      expect(res.totals.unattributed_labor).toBe(300); // y siguen sin atribuir solo los 3 h sueltos
    });
  });

  /**
   * En qué se va la mano de obra, por TIPO DE TRABAJO (Fase 3.4).
   *
   * Corre sobre su propio año (2032) para no depender del fixture de E6: un test que se cae porque
   * otro bloque agregó una jornada no estaría defendiendo nada.
   */
  describe('mano de obra por tipo de trabajo (3.4)', () => {
    const R = { from: '2032-01-01', to: '2032-12-31' };
    const DIA = '2032-05-10';

    beforeAll(async () => {
      // `one` y `companyId` viven en el beforeAll de afuera: se rearman acá en vez de subirlos, para
      // que este bloque no dependa del orden de los otros.
      const one = async (sql: string, args: unknown[] = []) => (await db.query<{ id: string }>(sql, args))[0].id;
      const companyId = await one(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [tenantId]);
      const caro = await one(`INSERT INTO employees (tenant_id, company_id, full_name, hourly_rate) VALUES ($1,$2,'Vet 3.4',20) RETURNING id`, [tenantId, companyId]);
      const barato = await one(`INSERT INTO employees (tenant_id, company_id, full_name, hourly_rate) VALUES ($1,$2,'Peón 3.4',5) RETURNING id`, [tenantId, companyId]);
      const sinTarifa = await one(`INSERT INTO employees (tenant_id, company_id, full_name) VALUES ($1,$2,'Eventual 3.4') RETURNING id`, [tenantId, companyId]);
      const tarea = (tipo: string) => one(`INSERT INTO tasks (tenant_id, farm_id, title, type) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, `T ${tipo}`, tipo]);
      const parte = (emp: string, task: string | null, hours: number) =>
        db.query(`INSERT INTO work_logs (tenant_id, employee_id, work_date, hours, task_id) VALUES ($1,$2,$3,$4,$5)`, [tenantId, emp, DIA, hours, task]);

      const sanidad = await tarea('health');
      const alimentacion = await tarea('feeding');
      const mantenimiento = await tarea('maintenance');
      await parte(caro, sanidad, 10); // 200
      await parte(barato, alimentacion, 100); // 500
      await parte(barato, mantenimiento, 10); // 50 con tarifa…
      await parte(sinTarifa, mantenimiento, 90); // …y 90 h que no se pueden valorizar
      await parte(barato, null, 20); // 100, sin tarea vinculada
    });

    it('agrupa las horas por el tipo de la tarea vinculada', async () => {
      const r: any = await svc.laborByActivity(R);
      expect(r.rows.find((x: any) => x.activity === 'health').cost).toBe(200);
      expect(r.rows.find((x: any) => x.activity === 'feeding').cost).toBe(500);
    });

    it('el costo por hora distingue quién hace cada trabajo', async () => {
      const r: any = await svc.laborByActivity(R);
      expect(r.rows.find((x: any) => x.activity === 'health').costPerHour).toBe(20);
      expect(r.rows.find((x: any) => x.activity === 'feeding').costPerHour).toBe(5);
    });

    it('UNA ACTIVIDAD CON POCA COBERTURA SE VE BARATA Y LA PANTALLA LO DICE', async () => {
      // El riesgo entero: mantenimiento es la segunda en horas (100) y casi la última en costo (50),
      // solo porque 90 de esas horas no tienen tarifa. Sin el aviso, «nos conviene hacerlo nosotros».
      const r: any = await svc.laborByActivity(R);
      const m = r.rows.find((x: any) => x.activity === 'maintenance');
      expect(m.hours).toBe(100);
      expect(m.cost).toBe(50);
      expect(m.coveragePct).toBe(10);
      expect(m.caveat).toMatch(/por debajo del real/i);
    });

    it('las jornadas sin tarea van al final y se nombran como dato faltante', async () => {
      const r: any = await svc.laborByActivity(R);
      expect(r.rows[r.rows.length - 1].activity).toBeNull();
      expect(r.totals.hoursWithoutActivity).toBe(20);
    });

    it('el total coincide con la valorización de E6: dos cortes, un solo número', async () => {
      // Si los dos cortes dieran totales distintos, ninguno sería creíble.
      const porActividad: any = await svc.laborByActivity(R);
      const porCentro: any = await svc.costsByCenter({ level: 'lot', ...R });
      const e6 = porCentro.totals.by_category.labor + porCentro.totals.unattributed_labor;
      expect(porActividad.totals.cost).toBeCloseTo(e6, 2);
      expect(porActividad.totals.unpricedHours).toBe(porCentro.totals.unpriced_hours);
    });

    it('fuera del rango no cuenta nada', async () => {
      const r: any = await svc.laborByActivity({ from: '2033-01-01', to: '2033-12-31' });
      expect(r.rows).toEqual([]);
      expect(r.totals.cost).toBe(0);
    });
  });
});
