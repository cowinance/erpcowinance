import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { ServicePlanService } from './service-plan.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import type { WeaningService } from './weaning.service';

/**
 * Reproducción E2 — servicios/diagnósticos/partos robustos: idempotencia por Idempotency-Key,
 * diagnóstico dudoso (agenda recontrol), aborto dedicado (cierra preñez + causa/edad gestacional +
 * tarea de revisión), parto que crea cría + cierra preñez + agenda tareas postparto (idempotente sin
 * duplicar crías), servicio grupal por lote y celos sin servir.
 */
describe('repro — servicios/diagnósticos/partos robustos (E2)', () => {
  let db: DbService;
  let repro: ReproService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let lot: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

  const mkFemale = async (tag?: string): Promise<string> => {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin)
       VALUES ($1,$2,$3,$4,$5,'F','active','born') RETURNING id`,
      [t, farmId, speciesId, vaca, lot],
    ))[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [t, id, tag]);
    return id;
  };
  const openPreg = (animal: string) =>
    db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, expected_due_date) VALUES ($1,$2,CURRENT_DATE - 250,'open',CURRENT_DATE)`, [t, animal]);
  const bump = async (animal: string) => (await db.query<any>(`SELECT count(*)::int AS n FROM breeding_events WHERE animal_id=$1`, [animal]))[0].n;
  const tasksFor = (animal: string) => db.query<any>(`SELECT title FROM tasks WHERE related_id=$1 AND deleted_at IS NULL`, [animal]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-e2-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)));
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('LOT')]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('servicio idempotente por Idempotency-Key', async () => {
    const a = await mkFemale(uniq('S'));
    const key = randomUUID();
    await repro.service(a, { method: 'natural' }, key);
    const again: any = await repro.service(a, { method: 'natural' }, key);
    expect(again.already).toBe(true);
    expect(await bump(a)).toBe(1);
  });

  it('diagnóstico dudoso agenda un recontrol (tarea) y no crea preñez', async () => {
    const a = await mkFemale(uniq('D'));
    const res: any = await repro.diagnose({ animal_id: a, result: 'doubtful' });
    expect(res.result).toBe('doubtful');
    expect(res.recheck_due).toBeTruthy();
    const tks = await tasksFor(a);
    expect(tks.some((x: any) => /Recontrol/.test(x.title))).toBe(true);
    const pregs = await db.query(`SELECT id FROM pregnancies WHERE animal_id=$1`, [a]);
    expect(pregs).toHaveLength(0);
  });

  it('aborto cierra la preñez como aborted con causa/edad y agenda revisión', async () => {
    const a = await mkFemale(uniq('A'));
    await openPreg(a);
    const res: any = await repro.abortion({ animal_id: a, cause: 'infecciosa', gestational_age_days: 120 });
    expect(res.result).toBe('aborted');
    expect(res.pregnancy_closed).toBe(true);
    const p = (await db.query<any>(`SELECT status, loss_cause, loss_gestational_days FROM pregnancies WHERE animal_id=$1`, [a]))[0];
    expect(p.status).toBe('aborted');
    expect(p.loss_cause).toBe('infecciosa');
    expect(p.loss_gestational_days).toBe(120);
    const tks = await tasksFor(a);
    expect(tks.some((x: any) => /Revisión por aborto/.test(x.title))).toBe(true);
  });

  it('parto crea cría, cierra preñez y agenda tareas postparto; idempotente sin duplicar', async () => {
    const a = await mkFemale(uniq('P'));
    await openPreg(a);
    const key = randomUUID();
    const res: any = await repro.calving({ dam_id: a, offspring: [{ sex: 'F', vitality: 'live' }] }, key);
    expect(res.offspring).toHaveLength(1);
    const calves1 = await db.query(`SELECT id FROM animals WHERE dam_id=$1`, [a]);
    expect(calves1).toHaveLength(1);
    const p = (await db.query<any>(`SELECT status FROM pregnancies WHERE animal_id=$1`, [a]))[0];
    expect(p.status).toBe('calved');
    const tks = await tasksFor(a);
    expect(tks.some((x: any) => /Revisión postparto/.test(x.title))).toBe(true);
    expect(tks.some((x: any) => /Preparar para servicio/.test(x.title))).toBe(true);
    // reproceso con la misma key → no crea otra cría ni otro parto
    const again: any = await repro.calving({ dam_id: a, offspring: [{ sex: 'F', vitality: 'live' }] }, key);
    expect(again.already).toBe(true);
    expect(await db.query(`SELECT id FROM animals WHERE dam_id=$1`, [a])).toHaveLength(1);
  });

  it('servicio grupal por lote aplica a los vientres del lote', async () => {
    const grpLot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('GRP')]))[0].id;
    const a1 = (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin) VALUES ($1,$2,$3,$4,$5,'F','active','born') RETURNING id`, [t, farmId, speciesId, vaca, grpLot]))[0].id;
    const a2 = (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin) VALUES ($1,$2,$3,$4,$5,'F','active','born') RETURNING id`, [t, farmId, speciesId, vaca, grpLot]))[0].id;
    const res: any = await repro.bulkService({ method: 'natural', lot_id: grpLot }, randomUUID());
    expect(res.applied).toBe(2);
    expect(await bump(a1)).toBe(1);
    expect(await bump(a2)).toBe(1);
  });

  it('celos sin servir lista los detectados sin servicio posterior', async () => {
    const a = await mkFemale(uniq('H'));
    await repro.heat(a, { intensity: 'high' });
    const list: any[] = await repro.heatsNotServed(30);
    expect(list.some((r) => r.animal_id === a)).toBe(true);
    // al servir, deja de aparecer
    await repro.service(a, { method: 'ai' });
    const list2: any[] = await repro.heatsNotServed(30);
    expect(list2.some((r) => r.animal_id === a)).toBe(false);
  });
});
