import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AnimalWriteService } from './animal-write.service';
import { HerdService } from './herd.service';
import { BillingService } from '../billing/billing.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ReportsService } from '../reports/reports.service';

describe('GDP derivado desde v_weighings', () => {
  let db: DbService;
  let herd: HerdService;
  let dashboard: DashboardService;
  let reports: ReportsService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let categoryId: string;
  let lotId: string;
  let lotName: string;
  let animalId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'weighing-adg-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    dashboard = new DashboardService(db);
    reports = new ReportsService(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    categoryId = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'novillo'`))[0].id;
    lotName = `GDP-${Date.now()}`;
    lotId = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, lotName]))[0].id;
    animalId = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin)
         VALUES ($1,$2,$3,$4,$5,'M','active','born') RETURNING id`,
        [tenantId, farmId, speciesId, categoryId, lotId],
      )
    )[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('recalcula GDP por orden real aunque el pesaje intermedio llegue despues', async () => {
    await db.query(
      `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, adg_since_last)
       VALUES ($1,$2,'2026-01-01T00:00:00.000Z',100,'scale',99),
              ($1,$2,'2026-01-11T00:00:00.000Z',130,'scale',99)`,
      [tenantId, animalId],
    );

    expect(
      await db.query<{ weight_kg: number; adg_since_last: number | null }>(
        `SELECT weight_kg::float, adg_since_last::float
         FROM v_weighings WHERE animal_id = $1 ORDER BY weighed_at`,
        [animalId],
      ),
    ).toEqual([
      { weight_kg: 100, adg_since_last: null },
      { weight_kg: 130, adg_since_last: 3 },
    ]);

    await db.query(
      `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method)
       VALUES ($1,$2,'2026-01-06T00:00:00.000Z',110,'scale')`,
      [tenantId, animalId],
    );

    const derived = await db.query<{ weight_kg: number; adg_since_last: number | null }>(
      `SELECT weight_kg::float, adg_since_last::float
       FROM v_weighings WHERE animal_id = $1 ORDER BY weighed_at`,
      [animalId],
    );
    expect(derived).toEqual([
      { weight_kg: 100, adg_since_last: null },
      { weight_kg: 110, adg_since_last: 2 },
      { weight_kg: 130, adg_since_last: 4 },
    ]);

    const animal = await herd.getAnimal(animalId);
    expect(animal.last_weighing.adg).toBe(4);

    const kpis = await dashboard.kpis();
    expect(kpis.avg_adg_kg_day).toBeGreaterThan(0);

    const production = await reports.production('2026-01-01', '2026-01-31');
    const lot = production.rows.find((r: any) => r.lote === lotName);
    expect(lot?.gdp_promedio).toBe(3);
  });
});
