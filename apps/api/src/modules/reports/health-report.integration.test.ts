import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReportsService } from './reports.service';
import { buildReportsService } from './reports.test-factory';

/**
 * Integración del reporte sanitario período-scoped (P9-2). Aísla del seed con ventanas futuras y
 * animales/productos propios. Fija conteos por período, desgloses, mortalidad (n + pérdida + tasa
 * autoconsistente) y exclusión de eliminados / fuera de rango. `db.tenant` cae al tenant demo.
 */
describe('reports.health — reporte sanitario del período', () => {
  let db: DbService;
  let reports: ReportsService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let cat: string;
  let p1: string;
  let p2: string;
  let originalCwd: string;
  let tmp: string;

  const mkAnimal = async (): Promise<string> =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, origin)
         VALUES ($1,$2,$3,$4,'M','active','born') RETURNING id`,
        [t, farmId, speciesId, cat],
      )
    )[0].id;
  const vaccinate = (animal: string, product: string, at: string) =>
    db.query<{ id: string }>(`INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at) VALUES ($1,$2,$3,$4) RETURNING id`, [t, animal, product, at]);
  const treat = (animal: string, route: string, at: string) =>
    db.query(`INSERT INTO treatments (tenant_id, animal_id, applied_at, route) VALUES ($1,$2,$3,$4)`, [t, animal, at, route]);
  const die = (animal: string, at: string, loss: number) =>
    db.query<{ id: string }>(`INSERT INTO mortalities (tenant_id, animal_id, died_at, estimated_loss) VALUES ($1,$2,$3,$4) RETURNING id`, [t, animal, at, loss]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'health-rep-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    reports = buildReportsService(db);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    cat = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'novillo'`))[0].id;
    p1 = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type) VALUES ($1,'Aftosa P9','vaccine') RETURNING id`, [t]))[0].id;
    p2 = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type) VALUES ($1,'Clostridial P9','vaccine') RETURNING id`, [t]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('vacunaciones y tratamientos: totales + desgloses; eliminados y fuera de rango excluidos', async () => {
    const a = await mkAnimal();
    await vaccinate(a, p1, '2027-09-05T00:00:00Z');
    await vaccinate(a, p1, '2027-09-06T00:00:00Z');
    await vaccinate(a, p2, '2027-09-07T00:00:00Z');
    const [{ id: delVac }] = await vaccinate(a, p1, '2027-09-08T00:00:00Z');
    await db.query(`UPDATE vaccinations SET deleted_at = now() WHERE id = $1`, [delVac]); // eliminada
    await vaccinate(a, p1, '2027-12-01T00:00:00Z'); // fuera de rango
    await treat(a, 'im', '2027-09-05T00:00:00Z');
    await treat(a, 'im', '2027-09-06T00:00:00Z');
    await treat(a, 'sc', '2027-09-07T00:00:00Z');

    const r = await reports.health('2027-09-01', '2027-09-30');
    expect(r.vacunaciones.total).toBe(3); // 2×p1 + 1×p2 (eliminada y fuera de rango excluidas)
    expect(r.vacunaciones.por_producto).toEqual([
      { producto: 'Aftosa P9', n: 2 },
      { producto: 'Clostridial P9', n: 1 },
    ]);
    expect(r.tratamientos.total).toBe(3);
    expect(r.tratamientos.por_via).toEqual([
      { via: 'im', n: 2 },
      { via: 'sc', n: 1 },
    ]);
  });

  it('mortalidad: n + pérdida estimada; eliminados y fuera de rango excluidos; tasa autoconsistente', async () => {
    const m1 = await mkAnimal();
    const m2 = await mkAnimal();
    const m3 = await mkAnimal();
    const m4 = await mkAnimal();
    await die(m1, '2028-04-05T00:00:00Z', 1000);
    await die(m2, '2028-04-06T00:00:00Z', 500);
    const [{ id: delMort }] = await die(m3, '2028-04-07T00:00:00Z', 999);
    await db.query(`UPDATE mortalities SET deleted_at = now() WHERE id = $1`, [delMort]); // eliminada
    await die(m4, '2028-08-01T00:00:00Z', 777); // fuera de rango

    const r = await reports.health('2028-04-01', '2028-04-30');
    expect(r.mortalidad.n).toBe(2);
    expect(r.mortalidad.perdida_estimada).toBe(1500);
    expect(r.mortalidad.base_activos).toBeGreaterThan(0);
    expect(r.mortalidad.tasa_pct).toBe(+((2 / r.mortalidad.base_activos) * 100).toFixed(2));
  });

  it('período sin eventos: totales 0, desgloses vacíos, tasa según base', async () => {
    const r = await reports.health('2029-01-01', '2029-01-31');
    expect(r.vacunaciones).toEqual({ total: 0, por_producto: [] });
    expect(r.tratamientos).toEqual({ total: 0, por_via: [] });
    expect(r.mortalidad.n).toBe(0);
    expect(r.mortalidad.perdida_estimada).toBe(0);
  });
});
