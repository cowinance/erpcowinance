import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { HealthReportsService } from './health-reports.service';

/**
 * Sanidad E7 — reportes sanitarios. Datos controlados: un diagnóstico, casos clínicos con distintos
 * desenlaces, tratamientos, y muertes con causa en un lote chico para gatillar la anomalía. Verifica
 * incidencia por diagnóstico, mortalidad por causa, reincidentes, productos más usados, efectividad y
 * detección de mortalidad anormal por lote.
 */
describe('HealthReportsService · integración', () => {
  let db: DbService;
  let svc: HealthReportsService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let diagId: string;
  let productId: string;
  let lotSmall: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `HR-${p}-${Date.now()}-${seq++}`;

  const mkAnimal = async (lot: string | null, status = 'active', tag?: string) => {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'F',$4,'born',$5) RETURNING id`,
      [tenantId, farmId, speciesId, status, lot],
    ))[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  };
  const mkCase = (animalId: string, status: string, outcome: string | null) =>
    db.query(`INSERT INTO clinical_cases (tenant_id, animal_id, diagnosis_id, status, outcome, started_at, created_by) VALUES ($1,$2,$3,$4,$5,now(),$6)`, [tenantId, animalId, diagId, status, outcome, userId]);
  const mkTreatment = (animalId: string) =>
    db.query(`INSERT INTO treatments (tenant_id, animal_id, diagnosis_id, product_id, applied_at, cost, created_by) VALUES ($1,$2,$3,$4,now(),25,$5)`, [tenantId, animalId, diagId, productId, userId]);
  const mkDeath = (animalId: string) =>
    db.query(`INSERT INTO mortalities (tenant_id, animal_id, died_at, cause_diagnosis_id, estimated_loss, created_by) VALUES ($1,$2,now(),$3,1000,$4)`, [tenantId, animalId, diagId, userId]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'health-reports-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new HealthReportsService(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    diagId = (await db.query<{ id: string }>(`INSERT INTO diagnoses (tenant_id, code, name, category, is_notifiable) VALUES ($1,'neumonia_r','Neumonía','respiratoria',false) RETURNING id`, [tenantId]))[0].id;
    productId = (await db.query<{ id: string }>(`INSERT INTO products_veterinary (tenant_id, name, type, created_by) VALUES ($1,'ATB Rep','antibiotic',$2) RETURNING id`, [tenantId, userId]))[0].id;
    lotSmall = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, uniq('LOTE'), userId]))[0].id;

    // reincidente: a1 con 2 casos; a2 con 1 caso recuperado; a3 muerto con causa.
    const a1 = await mkAnimal(lotSmall, 'active', uniq('A1'));
    const a2 = await mkAnimal(lotSmall, 'active', uniq('A2'));
    await mkCase(a1, 'in_treatment', null);
    await mkCase(a1, 'recovered', 'recovered');
    await mkCase(a2, 'recovered', 'recovered');
    await mkTreatment(a1);
    await mkTreatment(a2);
    // muerte con causa en el lote chico (1 muerto de 3 → 33% > umbral).
    const dead = await mkAnimal(lotSmall, 'dead', uniq('D'));
    await mkCase(dead, 'died', 'died');
    await mkDeath(dead);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('incidencia por diagnóstico: eventos y animales afectados', async () => {
    const rows: any[] = await svc.incidence();
    const row = rows.find((r) => r.diagnosis_id === diagId);
    expect(row).toBeTruthy();
    expect(row.diagnosis).toBe('Neumonía');
    expect(row.animals).toBeGreaterThanOrEqual(3); // a1, a2, dead
    expect(row.events).toBeGreaterThanOrEqual(5); // 3 casos + 2 tratamientos + 1 muerte (a1 dobla)
  });

  it('mortalidad por causa', async () => {
    const rows: any[] = await svc.mortality(undefined, undefined, 'cause');
    const row = rows.find((r) => r.cause === 'Neumonía');
    expect(row).toBeTruthy();
    expect(row.deaths).toBeGreaterThanOrEqual(1);
    expect(row.estimated_loss).toBeGreaterThanOrEqual(1000);
  });

  it('mortalidad por lote', async () => {
    const rows: any[] = await svc.mortality(undefined, undefined, 'lot');
    const row = rows.find((r) => r.lot_id === lotSmall);
    expect(row?.deaths).toBeGreaterThanOrEqual(1);
  });

  it('reincidentes: animal con ≥2 casos', async () => {
    const rows: any[] = await svc.recurrent(undefined, undefined, 2);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.cases >= 2)).toBe(true);
  });

  it('productos más usados', async () => {
    const rows: any[] = await svc.products();
    const row = rows.find((r) => r.product_id === productId);
    expect(row.applications).toBe(2);
    expect(row.animals).toBe(2);
  });

  it('efectividad: recuperados vs muertos + tasa de recuperación', async () => {
    const e: any = await svc.effectiveness();
    expect(e.recovered).toBeGreaterThanOrEqual(2);
    expect(e.died).toBeGreaterThanOrEqual(1);
    expect(e.recovery_rate_pct).toBeGreaterThan(0);
  });

  it('mortalidad anormal por lote: lote chico con muerte supera el umbral', async () => {
    const rows: any[] = await svc.mortalityAnomaly(90, 3);
    const row = rows.find((r) => r.lot_id === lotSmall);
    expect(row).toBeTruthy();
    expect(row.mortality_pct).toBeGreaterThanOrEqual(3);
  });
});
