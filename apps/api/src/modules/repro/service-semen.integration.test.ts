import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { ReproService } from './repro.service';

/**
 * Integración del consumo de pajuela en inseminación (G-2a): un servicio AI con semen_batch_id
 * descuenta 1 pajuela reusando SemenService (regla única); sin saldo → 403 y sin evento. `db.tenant`
 * cae al demo.
 */
describe('repro — consumo de pajuela en inseminación', () => {
  let db: DbService;
  let semen: SemenService;
  let repro: ReproService;
  let originalCwd: string;
  let tmp: string;
  let hembraId: string;

  const eventsOf = (animalId: string, batchId: string) =>
    db.query<any>(`SELECT id, semen_batch_id FROM breeding_events WHERE animal_id=$1 AND semen_batch_id=$2 AND deleted_at IS NULL`, [animalId, batchId]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'service-semen-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    semen = new SemenService(db, new StrawsService(db));
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, semen, new EmbryosService(db, new StrawsService(db)), new StrawsService(db));
    hembraId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND sex='F' AND status='active' AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('AI con partida descuenta 1 pajuela y guarda semen_batch_id en el evento', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-1', sire_name_external: 'Toro X', straws_available: 3 });
    const ev: any = await repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id });
    expect(ev.type).toBe('service_ai');
    expect((await semen.get(batch.id) as any).straws_available).toBe(2);
    expect((await eventsOf(hembraId, batch.id)).length).toBe(1);
  });

  it('saldo insuficiente → 403 y NO queda el evento (rollback lógico: consumo antes del insert)', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-0', sire_name_external: 'Toro Y', straws_available: 0 });
    await expect(repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id })).rejects.toMatchObject({ status: 403 });
    expect((await eventsOf(hembraId, batch.id)).length).toBe(0);
  });

  it('monta natural con semen_batch_id NO consume (se ignora)', async () => {
    const batch: any = await semen.create({ batch_code: 'NAT-1', sire_name_external: 'Toro Z', straws_available: 5 });
    await repro.service(hembraId, { method: 'natural', semen_batch_id: batch.id });
    expect((await semen.get(batch.id) as any).straws_available).toBe(5);
    expect((await eventsOf(hembraId, batch.id)).length).toBe(0);
  });

  it('AI sin partida funciona normal (sin consumo)', async () => {
    const ev: any = await repro.service(hembraId, { method: 'ai' });
    expect(ev.type).toBe('service_ai');
  });
});
