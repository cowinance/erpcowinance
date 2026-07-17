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
 * Sanidad E4 — aplicación masiva por objetivo (todo el hato / lote / categoría / selección) reusando
 * los núcleos neutrales, idempotente por (Idempotency-Key, animal); robusta ante animales no aptos
 * (se saltean con motivo, no abortan el resto); y cobertura por lote/categoría.
 */
describe('HealthService — aplicación masiva + cobertura (E4)', () => {
  let db: DbService;
  let health: HealthService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let vaccineId: string;
  let drugId: string;
  let lotA: string;
  let vacaCat: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `HM-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'health-mass-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    health = new HealthService(db, {} as MortalityService, new TreatmentService(db), new VaccinationService(db), new InventoryService(db));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    vacaCat = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
    vaccineId = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, created_by) VALUES ($1,'Aftosa M','vaccine',$2) RETURNING id`, [tenantId, userId]))[0].id;
    drugId = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, withdrawal_meat_days, created_by) VALUES ($1,'ATB M','antibiotic',20,$2) RETURNING id`, [tenantId, userId]))[0].id;
    lotA = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, uniq('LOTE'), userId]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(lot: string | null, status = 'active', category: string | null = null): Promise<string> {
    return (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,$4,'F',$5,'born',$6) RETURNING id`,
      [tenantId, farmId, speciesId, category, status, lot],
    ))[0].id;
  }
  const vaccCount = async (animalId: string) => (await db.query<any>(`SELECT count(*)::int AS n FROM vaccinations WHERE animal_id=$1`, [animalId]))[0].n;

  it('vacunación masiva por LOTE aplica a todos los activos del lote e idempotente por key', async () => {
    const a1 = await animal(lotA);
    const a2 = await animal(lotA);
    const key = randomUUID();
    const r1: any = await health.vaccinateMass({ scope: 'lot', lot_id: lotA, product_id: vaccineId }, key);
    expect(r1.resolved).toBe(2);
    expect(r1.applied).toBe(2);
    expect(await vaccCount(a1)).toBe(1);
    // reaplicar con la MISMA key → nada nuevo (idempotente)
    const r2: any = await health.vaccinateMass({ scope: 'lot', lot_id: lotA, product_id: vaccineId }, key);
    expect(r2.applied).toBe(0);
    expect(r2.already).toBe(2);
    expect(await vaccCount(a2)).toBe(1);
  });

  it('selección con un animal muerto → se saltea con motivo, el resto se aplica', async () => {
    const vivo = await animal(null, 'active');
    const muerto = await animal(null, 'dead');
    const r: any = await health.treatMass({ scope: 'selection', animal_ids: [vivo, muerto], product_id: drugId }, randomUUID());
    expect(r.resolved).toBe(2);
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.skipped_detail[0]).toMatchObject({ animal_id: muerto, reason: 'animal.not_treatable' });
  });

  it('objetivo CATEGORÍA aplica solo a esa categoría', async () => {
    const lotB = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, uniq('LB'), userId]))[0].id;
    const vaca = await animal(lotB, 'active', vacaCat);
    await animal(lotB, 'active', null); // sin categoría
    const r: any = await health.vaccinateMass({ scope: 'category', category_code: 'vaca', product_id: vaccineId }, randomUUID());
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect(await vaccCount(vaca)).toBeGreaterThanOrEqual(1);
  });

  it('producto de tipo incorrecto → 400 fail-fast (no aplica nada)', async () => {
    await expect(health.vaccinateMass({ scope: 'lot', lot_id: lotA, product_id: drugId }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'product.wrong_type' } });
  });

  it('selección vacía → 400', async () => {
    await expect(health.vaccinateMass({ scope: 'selection', animal_ids: [], product_id: vaccineId }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'mass.empty_selection' } });
  });

  it('cobertura por lote: cabezas, vacunados y porcentaje', async () => {
    const cov: any[] = await health.coverage('lot', vaccineId);
    const row = cov.find((c) => c.group_id === lotA);
    expect(row).toBeTruthy();
    expect(row.head).toBeGreaterThanOrEqual(2);
    expect(row.vaccinated).toBeGreaterThanOrEqual(2);
    expect(row.pct).toBeGreaterThan(0);
  });
});
