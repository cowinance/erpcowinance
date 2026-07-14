import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { EmbryosService } from './embryos.service';
import { EvaluationsService } from './evaluations.service';
import { SemenService } from './semen.service';
import { WeaningService } from '../repro/weaning.service';
import { TaskService } from '../tasks/task.service';
import { ReproService } from '../repro/repro.service';

/**
 * Integración de embriones + evaluaciones + consumo en transferencia (G-2b). `db.tenant` cae al demo.
 */
describe('genetics — embriones y evaluaciones', () => {
  let db: DbService;
  let embryos: EmbryosService;
  let evaluations: EvaluationsService;
  let repro: ReproService;
  let originalCwd: string;
  let tmp: string;
  let hembraId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'embryos-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    embryos = new EmbryosService(db);
    evaluations = new EvaluationsService(db);
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, new SemenService(db), embryos);
    hembraId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND sex='F' AND status='active' AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('embriones: crea, valida referencias/método/saldo y ajusta con no-negativo (403)', async () => {
    const e: any = await embryos.create({ donor_dam_id: hembraId, production_method: 'ivf', stage: 'blastocisto', straws_available: 4 });
    expect(e.production_method).toBe('ivf');
    expect(e.straws_available).toBe(4);
    await expect(embryos.create({ production_method: 'no-existe' })).rejects.toMatchObject({ status: 400 });
    await expect(embryos.create({ donor_dam_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    const sub: any = await embryos.adjustStraws(e.id, -3, 'transfer');
    expect(sub.straws_available).toBe(1);
    await expect(embryos.adjustStraws(e.id, -5, 'transfer')).rejects.toMatchObject({ status: 403 });
  });

  it('evaluaciones: registra por animal con traits jsonb; valida animal y traits', async () => {
    const ev: any = await evaluations.create({ animal_id: hembraId, source: 'Cabaña X', evaluation_date: '2030-03-01', traits: { peso_dep: 12.5, leche_dep: 3.2 } });
    expect(ev.traits.peso_dep).toBe(12.5);
    expect((await evaluations.list(hembraId)).some((x: any) => x.id === ev.id)).toBe(true);
    await expect(evaluations.create({ animal_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    await expect(evaluations.create({ animal_id: hembraId, traits: [1, 2] })).rejects.toMatchObject({ status: 400 });
  });

  it('transferencia embrionaria descuenta 1 embrión y guarda embryo_id; sin saldo → 403 sin evento', async () => {
    const e: any = await embryos.create({ donor_dam_id: hembraId, straws_available: 2 });
    const ev: any = await repro.service(hembraId, { method: 'embryo_transfer', embryo_id: e.id });
    expect(ev.type).toBe('embryo_transfer');
    expect((await embryos.get(e.id) as any).straws_available).toBe(1);
    const rows = await db.query<any>(`SELECT id FROM breeding_events WHERE embryo_id=$1 AND deleted_at IS NULL`, [e.id]);
    expect(rows.length).toBe(1);

    const empty: any = await embryos.create({ donor_dam_id: hembraId, straws_available: 0 });
    await expect(repro.service(hembraId, { method: 'embryo_transfer', embryo_id: empty.id })).rejects.toMatchObject({ status: 403 });
    expect((await db.query<any>(`SELECT id FROM breeding_events WHERE embryo_id=$1 AND deleted_at IS NULL`, [empty.id])).length).toBe(0);
  });
});
