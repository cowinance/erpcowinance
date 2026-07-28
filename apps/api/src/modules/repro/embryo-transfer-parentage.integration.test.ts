import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { StrawsService } from '../genetics/straws.service';
import { ServicePlanService } from './service-plan.service';
import { InbreedingService } from '../genetics/inbreeding.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

/**
 * Transferencia de embrión: la madre GENÉTICA y el VIENTRE son dos vacas distintas.
 *
 * La receptora gesta nueve meses y amamanta, pero no aporta un solo gen — el embrión ya estaba
 * formado con los genes de la donante y del toro. Con la receptora anotada como madre, la
 * genealogía miente, y todo lo que se derive hereda la mentira: el parentesco de esta cría, la
 * consanguinidad de SUS futuras crías, la evaluación genética.
 *
 * Y al mismo tiempo la receptora no puede desaparecer: es la que produjo esos kilos y la que hay
 * que poder rastrear.
 */
describe('transferencia de embrión — quién aporta los genes y quién el vientre', () => {
  let db: DbService;
  let repro: ReproService;
  let inbreeding: InbreedingService;
  let embryos: EmbryosService;
  let straws: StrawsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  let toro: string;
  let donante: string;
  let receptora: string;
  let cria: string;

  const animal = async (sex: 'F' | 'M', damId: string | null = null) =>
    (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, dam_id) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [db.tenant, farmId, speciesId, sex, damId],
      )
    )[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'et-parentage-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    straws = new StrawsService(db);
    embryos = new EmbryosService(db, straws);
    inbreeding = new InbreedingService(db);
    repro = new ReproService(
      db,
      new WeaningService(db),
      new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)),
      new SemenService(db, straws),
      embryos,
      straws,
      new ServicePlanService(db, straws),
      inbreeding,
    );
    farmId = (await db.query<any>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<any>(`SELECT id FROM species LIMIT 1`))[0].id;

    toro = await animal('M');
    donante = await animal('F');
    receptora = await animal('F');

    const emb: any = await embryos.create({ donor_dam_id: donante, sire_id: toro, stage: 'blastocyst', quantity: 1 });
    // Las pajuelas son la unidad física que se consume: sin ellas la transferencia rebota por saldo.
    await straws.createBatch({ embryo_id: emb.id }, { quantity: 1 });
    await repro.service(receptora, { method: 'embryo_transfer', embryo_id: emb.id, occurred_at: '2025-08-01' });
    await repro.diagnose({ animal_id: receptora, result: 'pregnant', occurred_at: '2025-09-15' });
    await repro.calving({ dam_id: receptora, calving_date: '2026-05-10', offspring: [{ sex: 'F', vitality: 'live' }] });

    cria = (
      await db.query<any>(`SELECT id FROM animals WHERE tenant_id=$1 AND birth_date='2026-05-10' AND deleted_at IS NULL LIMIT 1`, [
        db.tenant,
      ])
    )[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('LA MADRE DE LA CRÍA ES LA DONANTE, NO LA QUE PARIÓ', async () => {
    const [c] = await db.query<any>(`SELECT dam_id, recipient_dam_id, sire_id, breeding_method_origin FROM animals WHERE id=$1`, [cria]);
    expect(c.dam_id, 'la genealogía quedó con la receptora como madre').toBe(donante);
    expect(c.recipient_dam_id, 'se perdió el rastro de quién la gestó').toBe(receptora);
    expect(c.sire_id).toBe(toro);
    expect(c.breeding_method_origin).toBe('et');
  }, 120_000);

  it('UN MEDIO HERMANO POR LA DONANTE SE DETECTA — con el modelo viejo era invisible', async () => {
    // La prueba de fondo. Si `dam_id` apuntara a la receptora, este parentesco no existiría para el
    // sistema y se podrían aparear dos medios hermanos sin que nadie dijera nada.
    const medioHermano = await animal('M', donante);
    const f = await inbreeding.forMating(medioHermano, cria);
    expect(f.f).toBe(0.125);
    expect(f.blocks).toBe(true);
  }, 120_000);

  it('un hijo de la RECEPTORA no es pariente: ella no aportó genes', async () => {
    // El otro lado del mismo invariante. Bloquear acá sería impedir un apareamiento sano por un
    // parentesco que no se hereda.
    const hijoReceptora = await animal('M', receptora);
    const f = await inbreeding.forMating(hijoReceptora, cria);
    expect(f.f).toBe(0);
    expect(f.blocks).toBe(false);
  }, 120_000);

  it('EL DESTETE SE LE ACREDITA A LA RECEPTORA: la leche la puso ella', async () => {
    // El peso al destete es leche. Acreditárselo a la donante le regalaría kilos que no produjo y se
    // los sacaría a la vaca que trabajó el ciclo entero.
    await repro.weaning({ animal_id: cria, weaning_date: '2026-06-01', weight_kg: 210 });
    const [w] = await db.query<any>(`SELECT dam_id FROM weanings WHERE animal_id=$1 AND deleted_at IS NULL`, [cria]);
    expect(w.dam_id).toBe(receptora);
  }, 120_000);

  it('una transferencia NO se bloquea por parentesco con la receptora', async () => {
    // Ella gesta, no hereda. El apareamiento que importaba —donante × toro— ya ocurrió al armar el
    // embrión. Chequearlo acá frenaría transferencias sanas por un parentesco que no se transmite.
    const hija = await animal('F', toro === null ? null : toro); // hija del toro del embrión
    await db.query(`UPDATE animals SET sire_id=$1 WHERE id=$2`, [toro, hija]);
    const emb: any = await embryos.create({ donor_dam_id: donante, sire_id: toro, stage: 'blastocyst', quantity: 1 });
    await straws.createBatch({ embryo_id: emb.id }, { quantity: 1 });
    await expect(repro.service(hija, { method: 'embryo_transfer', embryo_id: emb.id })).resolves.toBeTruthy();
  }, 120_000);

  it('EL SEXO DE LA CRÍA SE INTERPRETA, no revienta contra la base', async () => {
    // Quien anota un parto en el corral escribe `H` de hembra. Antes ese valor llegaba crudo al
    // INSERT y daba un 500 —error interno al registrar un parto, de lo que más se carga—. Ahora, o
    // se entiende, o es un 400 que dice qué se esperaba.
    const otra = await animal('F');
    await repro.service(otra, { method: 'natural', sire_id: toro });
    await repro.diagnose({ animal_id: otra, result: 'pregnant' });
    const r: any = await repro.calving({ dam_id: otra, calving_date: '2026-06-01', offspring: [{ sex: 'H', vitality: 'live' }] });
    expect(r.offspring[0].sex).toBe('F');

    await expect(
      repro.calving({ dam_id: otra, calving_date: '2026-06-02', offspring: [{ sex: 'X', vitality: 'live' }] }),
    ).rejects.toMatchObject({ response: { code: 'calving.invalid_sex' } });
  }, 120_000);
});
