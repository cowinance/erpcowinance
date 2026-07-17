import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { HealthService } from './health.service';
import type { MortalityService } from './mortality.service';
import type { TreatmentService } from './treatment.service';
import type { VaccinationService } from './vaccination.service';

/**
 * Sanidad E3 — vistas de control. KPIs ampliados (casos abiertos, vacunas vencidas), lista de
 * animales críticos (caso abierto / retiro activo / vacuna vencida con motivos y puntaje) y sanidad
 * por lote (agregado de problemas rankeado). Datos controlados para números exactos. Las vistas sólo
 * usan `this.db`, así que los sub-servicios se pasan vacíos.
 */
describe('HealthService — vistas de control (E3)', () => {
  let db: DbService;
  let health: HealthService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let productVacc: string;
  let productDrug: string;
  let lotSick: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `HC-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'health-control-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    health = new HealthService(db, {} as MortalityService, {} as TreatmentService, {} as VaccinationService);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    productVacc = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, created_by) VALUES ($1,'Aftosa E3','vaccine',$2) RETURNING id`, [tenantId, userId]))[0].id;
    productDrug = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, withdrawal_meat_days, created_by) VALUES ($1,'ATB E3','antibiotic',30,$2) RETURNING id`, [tenantId, userId]))[0].id;
    lotSick = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, uniq('LOTE'), userId]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(lot: string | null, tag: string): Promise<string> {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'F','active','born',$4) RETURNING id`,
      [tenantId, farmId, speciesId, lot],
    ))[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  }
  const openCase = (animalId: string, severity = 'moderate') =>
    db.query(`INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at, created_by) VALUES ($1,$2,'in_treatment',$3,now(),$4)`, [tenantId, animalId, severity, userId]);
  const withdrawal = (animalId: string) =>
    db.query(`INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, meat_withdrawal_until, created_by) VALUES ($1,$2,$3,now(),CURRENT_DATE + 10,$4)`, [tenantId, animalId, productDrug, userId]);
  const overdueVacc = (animalId: string) =>
    db.query(`INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at, next_due_date, created_by) VALUES ($1,$2,$3,now() - interval '400 days', CURRENT_DATE - 10, $4)`, [tenantId, animalId, productVacc, userId]);

  it('KPIs incluyen casos abiertos y vacunas vencidas', async () => {
    const a = await animal(lotSick, uniq('K'));
    await openCase(a, 'severe');
    await overdueVacc(a);
    const k: any = await health.kpis();
    expect(k.clinical_cases_open).toBeGreaterThanOrEqual(1);
    expect(k.vaccinations_overdue).toBeGreaterThanOrEqual(1);
    expect('vaccination_coverage_pct' in k).toBe(true);
  });

  it('animales críticos: un renglón por animal con motivos y puntaje, ordenado por urgencia', async () => {
    const grave = await animal(lotSick, uniq('CRIT'));
    await openCase(grave, 'severe'); // 5
    await withdrawal(grave); // +2
    await overdueVacc(grave); // +1  → score 8
    const list: any[] = await health.criticalAnimals();
    const row = list.find((r) => r.animal_id === grave);
    expect(row).toBeTruthy();
    expect(row.has_open_case).toBe(true);
    expect(row.has_withdrawal).toBe(true);
    expect(row.has_overdue_vaccination).toBe(true);
    expect(row.score).toBe(8);
    // el más urgente encabeza la lista
    expect(list[0].score).toBeGreaterThanOrEqual(row.score);
  });

  it('vacuna renovada NO cuenta como vencida', async () => {
    const a = await animal(lotSick, uniq('RENEW'));
    await overdueVacc(a); // vieja, vencida
    // dosis posterior del MISMO producto → renueva
    await db.query(`INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at, next_due_date, created_by) VALUES ($1,$2,$3,now(), CURRENT_DATE + 300, $4)`, [tenantId, a, productVacc, userId]);
    const list: any[] = await health.criticalAnimals();
    const row = list.find((r) => r.animal_id === a);
    // sin otros motivos, no debería aparecer como crítico
    expect(row).toBeUndefined();
  });

  it('sanidad por lote: agrega problemas y rankea el lote más comprometido primero', async () => {
    const a1 = await animal(lotSick, uniq('L1'));
    const a2 = await animal(lotSick, uniq('L2'));
    await openCase(a1);
    await withdrawal(a2);
    const lots: any[] = await health.lotHealth();
    const row = lots.find((l) => l.lot_id === lotSick);
    expect(row).toBeTruthy();
    expect(row.open_cases).toBeGreaterThanOrEqual(1);
    expect(row.active_withdrawals).toBeGreaterThanOrEqual(1);
    expect(row.problem_score).toBeGreaterThanOrEqual(4);
    // el de mayor puntaje encabeza
    expect(lots[0].problem_score).toBeGreaterThanOrEqual(row.problem_score);
  });
});
