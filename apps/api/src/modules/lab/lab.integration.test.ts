import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { LabsService } from './labs.service';
import { SamplesService } from './samples.service';

/**
 * Integración de laboratorio (LAB-1/LAB-2): maestro, muestras con la máquina de estados
 * (collected→sent→in_progress→completed/rejected), resultados solo sobre muestras enviadas, y los
 * derivados (is_open, conteos). `db.tenant` cae al demo.
 */
describe('lab — laboratorio', () => {
  let db: DbService;
  let labs: LabsService;
  let samples: SamplesService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let labId: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lab-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    labs = new LabsService(db);
    samples = new SamplesService(db);
    tenantId = db.tenant;
    animalId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const lab: any = await labs.create({ name: 'LabVet SA', type: 'pathology', contact: { email: 'lab@vet.com' } });
    labId = lab.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('maestro: crea laboratorio y valida el tipo', async () => {
    expect(labId).toBeTruthy();
    await expect(labs.create({ name: 'X', type: 'invalido' })).rejects.toMatchObject({ status: 400 });
    await expect(labs.create({ name: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('muestra: nace collected, is_open true, tipo validado', async () => {
    const s: any = await samples.create({ sample_type: 'blood', animal_id: animalId, lab_id: labId });
    expect(s.status).toBe('collected');
    expect(s.is_open).toBe(true);
    expect(s.result_count).toBe(0);
    expect(s.animal_tag).toBeDefined();
    await expect(samples.create({ sample_type: 'plasma' })).rejects.toMatchObject({ status: 400 });
  });

  it('animal/potrero/lab inexistente → 404', async () => {
    const nil = '00000000-0000-0000-0000-000000000000';
    await expect(samples.create({ sample_type: 'blood', animal_id: nil })).rejects.toMatchObject({ status: 404 });
    await expect(samples.create({ sample_type: 'soil', paddock_id: nil })).rejects.toMatchObject({ status: 404 });
    await expect(samples.create({ sample_type: 'blood', lab_id: nil })).rejects.toMatchObject({ status: 404 });
  });

  it('máquina de estados: collected→sent→in_progress→completed; transición inválida → 409; idempotente', async () => {
    const s: any = await samples.create({ sample_type: 'milk', lab_id: labId });
    await expect(samples.setStatus(s.id, 'completed')).rejects.toMatchObject({ status: 409 }); // no se puede saltar
    const sent: any = await samples.setStatus(s.id, 'sent');
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).toBeTruthy(); // sella fecha de envío
    expect(await samples.setStatus(s.id, 'sent').then((x: any) => x.status)).toBe('sent'); // idempotente
    await samples.setStatus(s.id, 'in_progress');
    const done: any = await samples.setStatus(s.id, 'completed');
    expect(done.status).toBe('completed');
    expect(done.is_open).toBe(false);
    await expect(samples.setStatus(s.id, 'sent')).rejects.toMatchObject({ status: 409 }); // terminal
  });

  it('resultados: solo sobre muestra enviada; deriva conteos y anormales', async () => {
    const s: any = await samples.create({ sample_type: 'blood', animal_id: animalId, lab_id: labId });
    // 'collected' aún no salió al laboratorio → 409
    await expect(samples.addResult(s.id, { test_code: 'HB' })).rejects.toMatchObject({ status: 409 });
    await samples.setStatus(s.id, 'sent');
    await expect(samples.addResult(s.id, { result_value: '12' })).rejects.toMatchObject({ status: 400 }); // falta test_code
    await samples.addResult(s.id, { test_code: 'HB', result_value: '12', reference_range: '11-15', is_abnormal: false });
    await samples.addResult(s.id, { test_code: 'GLU', result_value: '180', reference_range: '60-110', is_abnormal: true });
    const results: any[] = await samples.listResults(s.id);
    expect(results).toHaveLength(2);
    const reread: any = await samples.get(s.id);
    expect(reread.result_count).toBe(2);
    expect(reread.abnormal_count).toBe(1);
  });

  it('baja lógica de la muestra', async () => {
    const s: any = await samples.create({ sample_type: 'hair' });
    await samples.remove(s.id);
    await expect(samples.get(s.id)).rejects.toMatchObject({ status: 404 });
  });
});
