import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { LotsService } from './lots.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Animales E3 — ficha 360: animalOverview compone sanidad/movimientos/producción
 * (lecturas directas, sin reimplementar reglas). El estado reproductivo lo sirve
 * ReproService (cubierto por sus tests); aquí se valida la composición del overview.
 */
describe('HerdService.animalOverview — ficha 360 (E3)', () => {
  let db: DbService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catF: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'overview-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    catF = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;

    animalId = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id) VALUES ($1,$2,$3,'F','active',$4) RETURNING id`,
        [db.tenant, farmId, speciesId, catF],
      )
    )[0].id;
    // Tratamiento con retiro activo.
    await db.query(
      `INSERT INTO treatments (tenant_id, animal_id, applied_at, meat_withdrawal_until) VALUES ($1,$2, now(), CURRENT_DATE + 5)`,
      [db.tenant, animalId],
    );
    // Caso clínico abierto.
    await db.query(
      `INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at) VALUES ($1,$2,'in_treatment','moderate', now() - INTERVAL '3 days')`,
      [db.tenant, animalId],
    );
    // Un parto (producción como madre).
    await db.query(`INSERT INTO calvings (tenant_id, dam_id, calving_date) VALUES ($1,$2, CURRENT_DATE - 60)`, [db.tenant, animalId]);
    // Un movimiento de ingreso a un lote.
    const lot = ((await lotsSvc.createLot({ name: 'Ov L' })) as any).id;
    await db.query(
      `INSERT INTO animal_movements (tenant_id, animal_id, movement_id, moved_at, to_lot_id, reason) VALUES ($1,$2,gen_random_uuid(), now() - INTERVAL '10 days', $3, 'ingreso')`,
      [db.tenant, animalId, lot],
    );
    await db.query(`UPDATE animals SET current_lot_id=$1 WHERE id=$2`, [lot, animalId]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('compone sanidad (tratamientos + casos abiertos)', async () => {
    const ov: any = await herd.animalOverview(animalId);
    expect(ov.health.treatments.length).toBe(1);
    expect(ov.health.treatments[0].withdrawal_active).toBe(true);
    expect(ov.health.open_cases.length).toBe(1);
    expect(ov.health.open_cases[0].severity).toBe('moderate');
    expect(Number(ov.health.open_cases[0].days_open)).toBeGreaterThanOrEqual(3);
  });

  it('compone producción (partos como madre)', async () => {
    const ov: any = await herd.animalOverview(animalId);
    expect(ov.production.calvings).toBe(1);
    expect(ov.production.last_calving).toBeTruthy();
  });

  it('compone movimientos y tiempo en el lote actual', async () => {
    const ov: any = await herd.animalOverview(animalId);
    expect(ov.movements.length).toBe(1);
    expect(ov.movements[0].kind).toBe('ingreso');
    expect(ov.days_in_current_lot).toBeGreaterThanOrEqual(9);
  });

  it('falla si el animal no existe', async () => {
    await expect(herd.animalOverview('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });
});
