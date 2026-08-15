import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { ReproStatusService } from './repro-status.service';
import { ReproReportsService } from './repro-reports.service';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { StrawsService } from '../genetics/straws.service';
import { ServicePlanService } from './service-plan.service';
import { InbreedingService } from '../genetics/inbreeding.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';

/**
 * Respuesta a la sincronización.
 *
 * En un programa de transferencia se prepara un lote de receptoras y el día de la jornada se revisa
 * una por una: la que formó cuerpo lúteo recibe el embrión, la que no, no sirve. Esa proporción
 * decide cuántas receptoras preparar la próxima vez para colocar los embriones que se tienen — y
 * antes no se podía medir, porque la que fallaba se anotaba como una nota suelta.
 */
describe('repro — respuesta a la sincronización', () => {
  let db: DbService;
  let repro: ReproService;
  let reports: ReproReportsService;
  let embryos: EmbryosService;
  let straws: StrawsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let embryoId: string;

  const receptora = async () =>
    (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'F','active') RETURNING id`,
        [db.tenant, farmId, speciesId],
      )
    )[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'sync-resp-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    straws = new StrawsService(db);
    embryos = new EmbryosService(db, straws);
    const status = new ReproStatusService(db);
    repro = new ReproService(
      db,
      new WeaningService(db),
      new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)),
      new SemenService(db, straws),
      embryos,
      straws,
      new ServicePlanService(db, straws),
      new InbreedingService(db),
      new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)),
      status,
    );
    reports = new ReproReportsService(db, status);
    farmId = (await db.query<any>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<any>(`SELECT id FROM species LIMIT 1`))[0].id;

    const toro = (await db.query<any>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'M','active') RETURNING id`, [db.tenant, farmId, speciesId]))[0].id;
    const donante = await receptora();
    const emb: any = await embryos.create({ donor_dam_id: donante, sire_id: toro, stage: 'blastocyst' });
    embryoId = emb.id;
    await straws.createBatch({ embryo_id: embryoId }, { quantity: 30 });

    // Una jornada: 14 revisadas, 9 responden y reciben embrión, 5 no.
    for (let i = 0; i < 14; i++) {
      const r = await receptora();
      if (i < 9) await repro.service(r, { method: 'embryo_transfer', embryo_id: embryoId });
      else await repro.recordSyncCheck({ animal_id: r, responded: false });
    }
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('LA TRANSFERENCIA SE CUENTA SOLA COMO RESPUESTA', async () => {
    // Es lo que hace exacto al denominador sin pedirle a la manga una segunda llamada con el animal
    // encerrado: no se puede transferir sin cuerpo lúteo, así que la transferencia ES la evidencia.
    const r: any = await reports.synchronization();
    expect(r.checked, 'las transferidas no entraron al denominador').toBe(14);
    expect(r.responded).toBe(9);
    expect(r.notResponded).toBe(5);
  }, 120_000);

  it('CONTESTA CUÁNTAS RECEPTORAS PREPARAR POR EMBRIÓN', async () => {
    // La razón práctica de medirlo: con 20 embriones y esta tasa hacen falta 32 receptoras, no 20.
    const r: any = await reports.synchronization();
    expect(r.ratePct).toBe(64.3);
    expect(r.recipientsPerEmbryo).toBe(1.6);
  }, 120_000);

  it('dice CUÁLES no respondieron, no solo cuántas', async () => {
    // El productor quiere mirarlas: condición corporal, anestro, si conviene volver a sincronizarlas.
    const r: any = await reports.synchronization();
    expect(r.not_responded).toHaveLength(5);
    expect(r.not_responded[0]).toHaveProperty('animal_id');
  }, 120_000);

  it('EL REGISTRO ES UN EVENTO PROPIO, no una nota', async () => {
    // Una nota queda visible en la ficha y es invisible para cualquier cuenta. Con un tipo propio se
    // puede medir; era exactamente lo que faltaba.
    const [fila] = await db.query<any>(
      `SELECT count(*)::int AS n FROM animal_events WHERE tenant_id=$1 AND event_type='synchronization_check' AND deleted_at IS NULL`,
      [db.tenant],
    );
    expect(fila.n).toBe(14);
  }, 120_000);

  it('exige un resultado explícito: sin `responded` no se registra nada', async () => {
    // Un registro a medias contaría en el denominador sin decir de qué lado, y desviaría la tasa.
    const r = await receptora();
    await expect(repro.recordSyncCheck({ animal_id: r })).rejects.toMatchObject({
      response: { code: 'sync_check.missing_result' },
    });
  }, 120_000);
});
