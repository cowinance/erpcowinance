import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReportsService } from './reports.service';
import { buildReportsService } from './reports.test-factory';

/**
 * Integración de los índices reproductivos período-scoped (P9-1). Aísla del seed usando ventanas
 * de fechas futuras (el demo carga eventos ~2026) y animales propios. Fija: fórmulas, semántica de
 * `null`, exclusión de eliminados y acotación por período. `db.tenant` cae al tenant demo.
 */
// Las fechas van SIN hora a propósito. Anclarlas a medianoche UTC (`T00:00:00Z`) las corría al día
// anterior una vez que la sesión pasó a correr en la zona de la finca (UTC−3): un servicio del 1 de
// marzo caía el 28 de febrero y quedaba fuera del período. Sin hora, PostgreSQL la interpreta en la
// zona de la sesión y el hecho cae el día que el fixture dice.
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
    reports = buildReportsService(db);
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
    await negative(a1, '2027-03-08');
    // 4 servicios en ventana + 1 fuera de rango (no debe contar).
    await service(a1, 'service_ai', '2027-03-01');
    await service(a1, 'service_natural', '2027-03-02');
    await service(a2, 'service_ai', '2027-03-03');
    await service(a2, 'embryo_transfer', '2027-03-04');
    await pregnancy(a1, '2027-06-01'); // fuera del período → excluido

    const r = await reports.reproduction('2027-03-01', '2027-03-31');
    expect(r.diagnosticos).toEqual({ positivos: 2, negativos: 1, total: 3 });
    expect(r.indices.prenez_pct).toBe(66.7); // 2/3
    expect(r.servicios.total).toBe(4);
    expect(r.indices.servicios_por_prenez).toBe(2); // 4/2
    // no queda rastro del KPI retirado (opción 1)
    expect(Object.keys(r.indices).sort()).toEqual(['iep_contados', 'iep_descartados', 'iep_dias', 'prenez_pct', 'servicios_por_prenez']);
    expect('vientres_prenados_pct' in r.indices).toBe(false);
  });

  it('caso 2: sin diagnósticos → prenez_pct y servicios_por_prenez null (no 0, no div/0)', async () => {
    const r = await reports.reproduction('2028-01-01', '2028-01-31');
    expect(r.indices.prenez_pct).toBeNull();
    expect(r.indices.servicios_por_prenez).toBeNull();
    expect(r.indices.iep_dias).toBeNull();
  });

  it('casos 3, 4 y 5: IEP promedia intervalos (parto posterior en período); 1 parto no aporta', async () => {
    // Los intervalos del fixture eran de 30 y 40 DÍAS, que ninguna vaca puede tener: una gestación
    // son 283. El test pasaba porque el cálculo tampoco lo miraba — el fixture tenía el mismo
    // problema que los datos, y por eso nadie notó que al indicador le faltaba la guarda.
    // Ahora son intervalos reales: 380 y 400 días.
    const d1 = await mkAnimal();
    const d2 = await mkAnimal();
    const d3 = await mkAnimal();
    await calving(d1, '2028-01-01');
    await calving(d1, '2029-01-15'); // 380 días, posterior en ventana
    await calving(d2, '2028-02-01');
    await calving(d2, '2029-03-07'); // 400 días, posterior en ventana
    await calving(d3, '2029-01-14'); // único parto → sin intervalo

    const r = await reports.reproduction('2029-01-13', '2029-04-01');
    expect(r.indices.iep_dias).toBe(390); // avg(380, 400)
    expect(r.indices.iep_contados).toBe(2);
    expect(r.indices.iep_descartados).toBe(0);
    expect(r.partos).toBe(3);
  });

  it('UN INTERVALO IMPOSIBLE NO ENTRA AL PROMEDIO, Y SE DICE CUÁNTOS QUEDARON AFUERA', async () => {
    // Medido contra la app: la finca demo reportaba «30 días» de intervalo entre partos, con los
    // cinco intervalos por debajo de una gestación. Un promedio así se lee como una vaca
    // extraordinaria, y encima de ese número se decide a quién retener y a quién descartar.
    //
    // Descartarlos EN SILENCIO sería cambiar una mentira por otra: el productor vería un número
    // creíble sin saber que parte de su historial no se pudo usar, ni que tiene fechas que corregir.
    // Ventana propia: los tests comparten base y los partos de los otros casos caerían adentro.
    const d1 = await mkAnimal();
    const d2 = await mkAnimal();
    await calving(d1, '2030-01-01');
    await calving(d1, '2031-01-16'); // 380 días: posible
    await calving(d2, '2031-01-01');
    await calving(d2, '2031-02-01'); // 31 días: imposible

    const r = await reports.reproduction('2031-01-10', '2031-04-01');
    expect(r.indices.iep_dias, 'solo el que puede ser cierto').toBe(380);
    expect(r.indices.iep_contados).toBe(1);
    expect(r.indices.iep_descartados).toBe(1);
  });

  it('si NINGUNO puede ser cierto, no hay promedio: null, no cero', async () => {
    // Cero se leería como «paren sin parar», que es la peor lectura posible.
    const d = await mkAnimal();
    await calving(d, '2033-01-01');
    await calving(d, '2033-02-01'); // 31 días

    const r = await reports.reproduction('2033-01-15', '2033-04-01');
    expect(r.indices.iep_dias).toBeNull();
    expect(r.indices.iep_descartados).toBe(1);
  });

  it('caso 6 aislado: servicios sin ninguna preñez → servicios_por_prenez null', async () => {
    const a = await mkAnimal();
    await service(a, 'service_ai', '2030-05-01');
    await service(a, 'service_natural', '2030-05-02');
    const r = await reports.reproduction('2030-05-01', '2030-05-31');
    expect(r.servicios.total).toBe(2);
    expect(r.indices.servicios_por_prenez).toBeNull();
    expect(r.indices.prenez_pct).toBeNull();
  });

  it('caso 7: eventos eliminados quedan excluidos', async () => {
    const a = await mkAnimal();
    const [{ id: pid }] = await pregnancy(a, '2031-06-05');
    await db.query(`UPDATE pregnancies SET deleted_at = now() WHERE id = $1`, [pid]); // positivo eliminado
    await negative(a, '2031-06-06'); // negativo vigente
    const r = await reports.reproduction('2031-06-01', '2031-06-30');
    expect(r.diagnosticos).toEqual({ positivos: 0, negativos: 1, total: 1 });
    expect(r.indices.prenez_pct).toBe(0); // 0/1 → 0%, NO null (sí hubo diagnóstico)
  });
});
