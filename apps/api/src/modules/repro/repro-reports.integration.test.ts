import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { ServicePlanService } from './service-plan.service';
import { ReproReportsService } from './repro-reports.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import type { WeaningService } from './weaning.service';
import type { TaskService } from '../tasks/task.service';
import { InbreedingService } from '../genetics/inbreeding.service';
import { MovementService } from '../../modules/land/movement.service';
import { SyncVersionStore } from '../../modules/sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../../modules/sync/registry/server-origin-changeset.writer';

/**
 * Reproducción E5 — reportes: KPIs de período (servicios, concepción, partos vivos/muertos, abortos,
 * intervalos), desempeño por toro (servicios/concepciones/tasa) y listas (abiertas/abortos). Las listas
 * de estado reusan la regla única vía ReproService.herdStatus. Datos controlados.
 */
describe('repro — reportes reproductivos (E5)', () => {
  let db: DbService;
  let repro: ReproService;
  let reports: ReproReportsService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let toro: string;
  let lot: string;
  let bullId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

  const mkAnimal = async (cat: string, sex: string, l: string | null): Promise<string> =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin) VALUES ($1,$2,$3,$4,$5,$6,'active','born') RETURNING id`,
      [t, farmId, speciesId, cat, l, sex],
    ))[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-reports-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    reports = new ReproReportsService(db, repro);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    toro = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'toro'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('LOT')]))[0].id;
    bullId = await mkAnimal(toro, 'M', lot);
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','TORO-1')`, [t, bullId]);

    // 2 servicios del toro; 1 concebido (con preñez), 1 no.
    const c1 = await mkAnimal(vaca, 'F', lot);
    const svc1 = (await db.query<{ id: string }>(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id) VALUES ($1,$2,'service_natural',CURRENT_DATE - 100,$3) RETURNING id`, [t, c1, bullId]))[0].id;
    await db.query(`INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, status, expected_due_date) VALUES ($1,$2,$3,CURRENT_DATE - 70,'open',CURRENT_DATE + 180)`, [t, c1, svc1]);
    const c2 = await mkAnimal(vaca, 'F', lot);
    await db.query(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id) VALUES ($1,$2,'service_natural',CURRENT_DATE - 100,$3)`, [t, c2, bullId]);
    await db.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at) VALUES ($1,$2,'pregnancy_negative','{}'::jsonb,CURRENT_DATE - 60,now())`, [t, c2]);

    // 1 parto con cría viva y una muerta.
    const dam = await mkAnimal(vaca, 'F', lot);
    const cal = (await db.query<{ id: string }>(`INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2,CURRENT_DATE - 30,2) RETURNING id`, [t, dam]))[0].id;
    await db.query(`INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, vitality) VALUES ($1,$2,NULL,'live'),($1,$2,NULL,'stillborn')`, [t, cal]);

    // 1 aborto con causa.
    const ab = await mkAnimal(vaca, 'F', lot);
    await db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, closed_at, loss_cause, loss_gestational_days) VALUES ($1,$2,CURRENT_DATE - 50,'aborted',CURRENT_DATE - 20,'infecciosa',100)`, [t, ab]);

    // 1 vaca abierta crítica (parto viejo, sin preñez).
    const open = await mkAnimal(vaca, 'F', lot);
    await db.query(`INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2,CURRENT_DATE - 140,1)`, [t, open]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('summary: servicios, tasa de concepción, partos vivos/muertos, abortos, destete', async () => {
    const s: any = await reports.summary();
    expect(s.services.total).toBeGreaterThanOrEqual(2);
    // La tasa sale de los SERVICIOS, no de los diagnósticos: es la definición de zootecnia y la
    // misma que usa el reporte por toro. Contada sobre diagnósticos, una finca que registra solo los
    // positivos —lo habitual— daba 100% para siempre.
    // Se afirma la DEFINICIÓN, no una cifra: el resumen cuenta también lo que trae el seed, y atar
    // el test a un número concreto lo haría frágil sin probar nada más.
    expect(s.conception_rate_pct).toBe(+((s.diagnoses.pregnant / s.services.total) * 100).toFixed(1));
    // Y las dos definiciones dan DISTINTO cuando faltan diagnósticos negativos, que es el caso que
    // hacía que la finca demo reportara 100%.
    expect(s.diagnoses.positive_pct).toBeGreaterThan(s.conception_rate_pct);
    expect(s.calvings.live).toBeGreaterThanOrEqual(1);
    expect(s.calvings.dead).toBeGreaterThanOrEqual(1);
    expect(s.abortions).toBeGreaterThanOrEqual(1);
    expect(s.avg_days_since_calving_open).toBeGreaterThan(0);
  });

  it('LA TASA Y LOS SERVICIOS POR CONCEPCIÓN SON EL MISMO NÚMERO, AL DERECHO Y AL REVÉS', async () => {
    // Es lo que no cerraba: el resumen decía «100%» y «1,41 servicios por concepción» uno al lado del
    // otro. Si la tasa se cuenta sobre servicios, es exactamente el inverso — y si algún día alguien
    // vuelve a cambiar una de las dos cuentas, esto lo dice.
    const s: any = await reports.summary();
    if (s.conception_rate_pct == null || s.services_per_conception == null) return;
    expect(+(100 / s.services_per_conception).toFixed(1)).toBeCloseTo(s.conception_rate_pct, 0);
  });

  it('desempeño por toro: servicios, concepciones y tasa', async () => {
    const rows: any[] = await reports.byBull();
    const row = rows.find((r) => r.sire_id === bullId);
    expect(row).toBeTruthy();
    expect(row.services).toBe(2);
    expect(row.conceptions).toBe(1);
    expect(row.conception_rate_pct).toBe(50);
  });

  it('abortos: lista con causa y edad gestacional', async () => {
    const rows: any[] = await reports.abortions();
    expect(rows.some((r) => r.loss_cause === 'infecciosa' && r.loss_gestational_days === 100)).toBe(true);
  });

  it('abiertas: derivadas del estado (regla única)', async () => {
    const rows: any[] = await reports.openCows();
    expect(rows.every((r) => r.status === 'open')).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
