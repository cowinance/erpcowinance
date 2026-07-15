import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { DairyService } from './dairy.service';

/**
 * Integración del tambo (TB-1): tanques y producción diaria por vaca. La producción de una vaca en un
 * día es un HECHO ÚNICO: re-registrarlo actualiza (upsert), no duplica. `db.tenant` cae al demo.
 */
describe('dairy — tambo', () => {
  let db: DbService;
  let svc: DairyService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let cow: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'dairy-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new DairyService(db);
    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;
    cow = (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F','active','born') RETURNING id`, [tenantId, farmId, speciesId]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un tanque', async () => {
    const t: any = await svc.createTank({ name: 'Tanque frío', capacity_liters: 5000 });
    expect(t.name).toBe('Tanque frío');
    expect(t.capacity_liters).toBe(5000);
    await expect(svc.createTank({ name: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('producción diaria: registra litros y ordeñes; valida animal y litros', async () => {
    const p: any = await svc.recordProduction({ animal_id: cow, production_date: '2030-05-01', total_liters: 25.5, milking_count: 2 });
    expect(p.total_liters).toBe(25.5);
    expect(p.milking_count).toBe(2);
    await expect(svc.recordProduction({ animal_id: cow, production_date: '2030-05-01', total_liters: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.recordProduction({ animal_id: '00000000-0000-0000-0000-000000000000', production_date: '2030-05-01', total_liters: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('hecho único por vaca/día: re-registrar el mismo día ACTUALIZA (upsert), no duplica', async () => {
    await svc.recordProduction({ animal_id: cow, production_date: '2030-05-02', total_liters: 20 });
    const again: any = await svc.recordProduction({ animal_id: cow, production_date: '2030-05-02', total_liters: 28, milking_count: 3 });
    expect(again.total_liters).toBe(28); // corregido
    const rows: any[] = await svc.listProduction('2030-05-02', cow);
    expect(rows).toHaveLength(1); // una sola fila para ese día
    expect(rows[0].total_liters).toBe(28);
  });

  it('lista por fecha', async () => {
    const rows: any[] = await svc.listProduction('2030-05-01');
    expect(rows.some((r) => r.animal_id === cow && r.total_liters === 25.5)).toBe(true);
  });
});
