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
import { InbreedingService } from '../genetics/inbreeding.service';

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
    repro = new ReproService(db, {} as WeaningService, new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db));
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

  it('DOS PARTOS MÁS CERCA QUE UNA GESTACIÓN SE RECHAZAN', async () => {
    // Una vaca no puede parir dos veces separadas por menos de 283 días: habría tenido que quedar
    // preñada antes de parir. Se frena al CARGAR porque un dato así ya no se corrige solo — infla
    // los kilos por año de esa vaca y encima se decide la reposición al revés.
    const a = await mkFemale(uniq('FREQ'));
    await repro.calving({ dam_id: a, calving_date: '2025-03-01', offspring: [{ sex: 'F' }] });
    await expect(
      repro.calving({ dam_id: a, calving_date: '2025-09-01', offspring: [{ sex: 'F' }] }),
    ).rejects.toMatchObject({ response: { code: 'calving.impossible_interval' } });
  });

  it('DOS PARTOS EL MISMO DÍA APUNTAN A MELLIZOS, y el mensaje lo dice', async () => {
    // Es la causa más frecuente y la que el productor puede corregir solo: los mellizos van como dos
    // crías del mismo parto, no como dos partos.
    const a = await mkFemale(uniq('MELL'));
    await repro.calving({ dam_id: a, calving_date: '2025-05-10', offspring: [{ sex: 'F' }] });
    await expect(
      repro.calving({ dam_id: a, calving_date: '2025-05-10', offspring: [{ sex: 'M' }] }),
    ).rejects.toMatchObject({ response: { title: expect.stringContaining('mellizos') } });
  });

  it('un parto por año entra sin molestar', async () => {
    // La otra mitad: si frenara un intervalo normal, el productor aprendería a forzar siempre.
    const a = await mkFemale(uniq('OK'));
    await repro.calving({ dam_id: a, calving_date: '2024-03-01', offspring: [{ sex: 'F' }] });
    const r: any = await repro.calving({ dam_id: a, calving_date: '2025-03-05', offspring: [{ sex: 'F' }] });
    expect(r.offspring).toHaveLength(1);
  });

  it('`force` deja cargar historia vieja con fechas aproximadas', async () => {
    // Quien migra años de planillas tiene fechas redondeadas: necesita poder seguir, pero diciéndolo.
    const a = await mkFemale(uniq('FORCE'));
    await repro.calving({ dam_id: a, calving_date: '2025-03-01', offspring: [{ sex: 'F' }] });
    const r: any = await repro.calving({ dam_id: a, calving_date: '2025-06-01', offspring: [{ sex: 'F' }], force: true });
    expect(r.offspring).toHaveLength(1);
  });

  it('LA GUARDA NO ROMPE EL REINTENTO: un parto reenviado no choca contra sí mismo', async () => {
    // El móvil reenvía con la misma clave cuando se corta la señal. Sin excluirse a sí misma, la
    // guarda de intervalo veía el parto ya registrado y lo rechazaba por «dos partos el mismo día»
    // — rompiendo la idempotencia justo en el escenario para el que existe.
    const a = await mkFemale(uniq('RETRY'));
    const key = randomUUID();
    await repro.calving({ dam_id: a, calving_date: '2025-04-01', offspring: [{ sex: 'F' }] }, key);
    const otra: any = await repro.calving({ dam_id: a, calving_date: '2025-04-01', offspring: [{ sex: 'F' }] }, key);
    expect(otra.already ?? true).toBeTruthy();
    expect(await db.query(`SELECT id FROM calvings WHERE dam_id=$1 AND deleted_at IS NULL`, [a])).toHaveLength(1);
  });

  it('UNA CRÍA YA REGISTRADA SE VINCULA, NO SE DUPLICA', async () => {
    // Pasa de verdad: el ternero se carga en la manga apenas nace y el parto se anota después, en la
    // oficina. Antes `animal_id` se ignoraba en silencio y la segunda carga creaba un animal NUEVO:
    // dos terneros donde había uno, los dos contando en el hato, en los KPIs y en los kilos
    // destetados de la madre. Se descubrió auditando, con 18 duplicados de golpe.
    const madre = await mkFemale(uniq('VINC'));
    const [{ id: cria }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) 
       SELECT $1, farm_id, species_id, 'M', 'active' FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, madre],
    );
    const antes = (await db.query<any>(`SELECT id FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant])).length;

    const r: any = await repro.calving({ dam_id: madre, calving_date: '2026-05-10', offspring: [{ animal_id: cria }] });
    const despues = (await db.query<any>(`SELECT id FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant])).length;

    expect(despues, 'se creó un animal nuevo en vez de vincular el que había').toBe(antes);
    expect(r.offspring[0].animal_id).toBe(cria);
    // El sexo sale del ANIMAL, no del payload: quien anota el parto no siempre lo manda, y por
    // defecto es hembra — reportar eso haría que la respuesta mienta.
    expect(r.offspring[0].sex).toBe('M');

    const [a] = await db.query<any>(`SELECT dam_id, birth_date::text AS birth_date FROM animals WHERE id=$1`, [cria]);
    expect(a.dam_id, 'el parto sabe de quién es hija y tiene que completarlo').toBe(madre);
    expect(a.birth_date).toBe('2026-05-10');
  });

  it('la misma cría no se puede registrar en dos partos', async () => {
    const madre = await mkFemale(uniq('DOS'));
    const [{ id: cria }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status)
       SELECT $1, farm_id, species_id, 'F', 'active' FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, madre],
    );
    await repro.calving({ dam_id: madre, calving_date: '2025-01-10', offspring: [{ animal_id: cria }] });
    await expect(
      repro.calving({ dam_id: madre, calving_date: '2026-01-10', offspring: [{ animal_id: cria }] }),
    ).rejects.toMatchObject({ response: { code: 'calving.offspring_already_linked' } });
  });

  it('NO SE LE PISA LA MADRE A UNA CRÍA QUE YA TIENE OTRA', async () => {
    // O el parto es de otra vaca o la genealogía estaba mal: las dos cosas las resuelve una persona,
    // no un UPDATE silencioso.
    const madreReal = await mkFemale(uniq('REAL'));
    const otra = await mkFemale(uniq('OTRA'));
    const [{ id: cria }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, dam_id)
       SELECT $1, farm_id, species_id, 'F', 'active', $3 FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, madreReal, madreReal],
    );
    await expect(
      repro.calving({ dam_id: otra, calving_date: '2026-06-01', offspring: [{ animal_id: cria }] }),
    ).rejects.toMatchObject({ response: { code: 'calving.offspring_other_dam' } });
  });

  it('una cría inexistente se rechaza en vez de ignorarse', async () => {
    const madre = await mkFemale(uniq('FANT'));
    await expect(
      repro.calving({ dam_id: madre, calving_date: '2026-06-01', offspring: [{ animal_id: randomUUID() }] }),
    ).rejects.toMatchObject({ response: { code: 'calving.offspring_not_found' } });
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
