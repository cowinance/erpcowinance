import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CarcassService } from './carcass.service';

/**
 * Integración de faena (FA-1): el rendimiento se DERIVA del último peso vivo (≤ fecha de faena); una res
 * por animal; integridad con la venta de hacienda y el frigorífico. `db.tenant` cae al demo.
 */
describe('slaughter — faena', () => {
  let db: DbService;
  let carcasses: CarcassService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'carcass-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    carcasses = new CarcassService(db);
    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(): Promise<string> {
    return (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','sold','born') RETURNING id`, [tenantId, farmId, speciesId]))[0].id;
  }
  async function weigh(animalId: string, kg: number, at: string) {
    await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,$3,$4)`, [tenantId, animalId, at, kg]);
  }

  it('rendimiento DERIVADO: res 270 kg sobre 500 kg vivos → 54%', async () => {
    const a = await animal();
    await weigh(a, 500, '2030-05-01T10:00:00Z');
    const c: any = await carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270, conformation: 'A', fat_grade: '2' });
    expect(c.dressing_pct).toBe(54);
    expect(c.live_weight_kg).toBe(500); // el peso usado se expone (auditable)
    expect(c.conformation).toBe('A');
  });

  it('usa la última pesada EN O ANTES de la faena (ignora las posteriores)', async () => {
    const a = await animal();
    await weigh(a, 400, '2030-04-01T10:00:00Z');
    await weigh(a, 480, '2030-05-09T10:00:00Z'); // la que corresponde
    await weigh(a, 999, '2030-06-01T10:00:00Z'); // posterior a la faena: se ignora
    const c: any = await carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 260 });
    expect(c.live_weight_kg).toBe(480);
    expect(c.dressing_pct).toBe(54.17); // 260/480
  });

  it('sin pesadas → rendimiento null (no inventa un número)', async () => {
    const a = await animal();
    const c: any = await carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270 });
    expect(c.dressing_pct).toBeNull();
    expect(c.live_weight_kg).toBeNull();
  });

  it('una res por animal → 409; animal ajeno → 404; res más pesada que el vivo → 400', async () => {
    const a = await animal();
    await weigh(a, 500, '2030-05-01T10:00:00Z');
    await carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270 });
    await expect(carcasses.record({ animal_id: a, slaughter_date: '2030-05-11', hot_carcass_weight_kg: 280 })).rejects.toMatchObject({ status: 409 });
    await expect(carcasses.record({ animal_id: '00000000-0000-0000-0000-000000000000', slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270 })).rejects.toMatchObject({ status: 404 });

    const b = await animal();
    await weigh(b, 300, '2030-05-01T10:00:00Z');
    await expect(carcasses.record({ animal_id: b, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 400 })).rejects.toMatchObject({ status: 400 }); // res > vivo
    await expect(carcasses.record({ animal_id: b, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('integridad con Comercial: venta inexistente → 404; frigorífico inexistente → 404', async () => {
    const a = await animal();
    await expect(carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270, sale_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    await expect(carcasses.record({ animal_id: a, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270, slaughterhouse_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });
});
