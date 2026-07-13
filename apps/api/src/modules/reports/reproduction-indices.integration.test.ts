import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReportsService } from './reports.service';

/**
 * Integración de los índices reproductivos período-scoped (P9-1). Aísla del seed usando ventanas
 * de fechas futuras (el demo carga eventos ~2026) y animales propios. Fija: fórmulas, semántica de
 * `null`, exclusión de eliminados y acotación por período. `db.tenant` cae al tenant demo.
 */
describe('reports.reproduction — índices del período', () => {
  let db: DbService;
  let reports: ReportsService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let originalCwd: string;
  let tmp: string;

  const mkAnimal = async (): Promise<string> =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, origin)
         VALUES ($1,$2,$3,$4,'F','active','born') RETURNING id`,
        [t, farmId, speciesId, vaca],
      )
    )[0].id;
  const service = (animal: string, type: string, at: string) =>
    db.query(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at) VALUES ($1,$2,$3,$4)`, [t, animal, type, at]);
  const pregnancy = (animal: string, date: string) =>
    db.query<{ id: string }>(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status) VALUES ($1,$2,$3,'open') RETURNING id`, [t, animal, date]);
  const negative = (animal: string, at: string) =>
    db.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at) VALUES ($1,$2,'pregnancy_negative','{}'::jsonb,$3,$3)`, [t, animal, at]);
  const calving = (dam: string, date: string) =>
    db.query(`INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2,$3,1)`, [t, dam, date]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-idx-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    reports = new ReportsService(db);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('caso 1 y 6 y 8: % preñez = pos/(pos+neg); servicios/preñez; out-of-range excluido', async () => {
    const a1 = await mkAnimal();
    const a2 = await mkAnimal();
    await pregnancy(a1, '2027-03-05');
    await pregnancy(a2, '2027-03-10');
    await negative(a1, '2027-03-08T00:00:00Z');
    // 4 servicios en ventana + 1 fuera de rango (no debe contar).
    await service(a1, 'service_ai', '2027-03-01T00:00:00Z');
    await service(a1, 'service_natural', '2027-03-02T00:00:00Z');
    await service(a2, 'service_ai', '2027-03-03T00:00:00Z');
    await service(a2, 'embryo_transfer', '2027-03-04T00:00:00Z');
    await pregnancy(a1, '2027-06-01'); // fuera del período → excluido

    const r = await reports.reproduction('2027-03-01', '2027-03-31');
    expect(r.diagnosticos).toEqual({ positivos: 2, negativos: 1, total: 3 });
    expect(r.indices.prenez_pct).toBe(66.7); // 2/3
    expect(r.servicios.total).toBe(4);
    expect(r.indices.servicios_por_prenez).toBe(2); // 4/2
    // no queda rastro del KPI retirado (opción 1)
    expect(Object.keys(r.indices).sort()).toEqual(['iep_dias', 'prenez_pct', 'servicios_por_prenez']);
    expect('vientres_prenados_pct' in r.indices).toBe(false);
  });

  it('caso 2: sin diagnósticos → prenez_pct y servicios_por_prenez null (no 0, no div/0)', async () => {
    const r = await reports.reproduction('2028-01-01', '2028-01-31');
    expect(r.indices.prenez_pct).toBeNull();
    expect(r.indices.servicios_por_prenez).toBeNull();
    expect(r.indices.iep_dias).toBeNull();
  });

  it('casos 3, 4 y 5: IEP promedia intervalos (parto posterior en período); 1 parto no aporta', async () => {
    const d1 = await mkAnimal();
    const d2 = await mkAnimal();
    const d3 = await mkAnimal();
    await calving(d1, '2029-01-01');
    await calving(d1, '2029-01-31'); // gap 30, posterior en ventana
    await calving(d2, '2029-02-01');
    await calving(d2, '2029-03-13'); // gap 40, posterior en ventana
    await calving(d3, '2029-01-15'); // único parto → sin intervalo

    const r = await reports.reproduction('2029-01-20', '2029-04-01');
    expect(r.indices.iep_dias).toBe(35); // avg(30, 40); d3 excluido
    expect(r.partos).toBe(3); // 3 partos caen en la ventana (01-31, 03-13, ... y 01-15? no: 01-15 < from 01-20)
  });

  it('caso 6 aislado: servicios sin ninguna preñez → servicios_por_prenez null', async () => {
    const a = await mkAnimal();
    await service(a, 'service_ai', '2030-05-01T00:00:00Z');
    await service(a, 'service_natural', '2030-05-02T00:00:00Z');
    const r = await reports.reproduction('2030-05-01', '2030-05-31');
    expect(r.servicios.total).toBe(2);
    expect(r.indices.servicios_por_prenez).toBeNull();
    expect(r.indices.prenez_pct).toBeNull();
  });

  it('caso 7: eventos eliminados quedan excluidos', async () => {
    const a = await mkAnimal();
    const [{ id: pid }] = await pregnancy(a, '2031-06-05');
    await db.query(`UPDATE pregnancies SET deleted_at = now() WHERE id = $1`, [pid]); // positivo eliminado
    await negative(a, '2031-06-06T00:00:00Z'); // negativo vigente
    const r = await reports.reproduction('2031-06-01', '2031-06-30');
    expect(r.diagnosticos).toEqual({ positivos: 0, negativos: 1, total: 1 });
    expect(r.indices.prenez_pct).toBe(0); // 0/1 → 0%, NO null (sí hubo diagnóstico)
  });
});
