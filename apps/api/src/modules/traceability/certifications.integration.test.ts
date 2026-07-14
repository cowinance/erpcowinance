import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CertificationsService } from './certifications.service';

/**
 * Integración de certificaciones (T-2): CRUD polimórfico, vencimiento derivado y estados.
 * `db.tenant` cae al demo.
 */
describe('traceability — certificaciones', () => {
  let db: DbService;
  let svc: CertificationsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'certs-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new CertificationsService(db);
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    animalId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea certificación por farm/animal (valida entidad) y difiere product', async () => {
    const c: any = await svc.create({ entity_type: 'farm', entity_id: farmId, scheme: 'SENASA', issuer: 'Ente', valid_from: '2030-01-01', valid_until: '2031-01-01' });
    expect(c.entity_type).toBe('farm');
    expect(c.status).toBe('active');
    expect(c.is_expired).toBe(false);
    await svc.create({ entity_type: 'animal', entity_id: animalId, scheme: 'Trazabilidad' });
    await expect(svc.create({ entity_type: 'product', entity_id: farmId, scheme: 'X' })).rejects.toMatchObject({ status: 400 }); // diferido
    await expect(svc.create({ entity_type: 'farm', entity_id: '00000000-0000-0000-0000-000000000000', scheme: 'X' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.create({ entity_type: 'farm', entity_id: farmId, scheme: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('is_expired derivado de valid_until (< hoy → vencida)', async () => {
    const c: any = await svc.create({ entity_type: 'farm', entity_id: farmId, scheme: 'Vieja', valid_until: '2020-01-01' });
    expect(c.is_expired).toBe(true);
    expect(c.status).toBe('active'); // el estado sigue manual; el vencimiento es un flag
  });

  it('estados: active→suspended→active; →revoked terminal; transición inválida → 409', async () => {
    const c: any = await svc.create({ entity_type: 'farm', entity_id: farmId, scheme: 'Estados' });
    const s: any = await svc.updateStatus(c.id, 'suspended');
    expect(s.status).toBe('suspended');
    const a: any = await svc.updateStatus(c.id, 'active');
    expect(a.status).toBe('active');
    const r: any = await svc.updateStatus(c.id, 'revoked');
    expect(r.status).toBe('revoked');
    await expect(svc.updateStatus(c.id, 'active')).rejects.toMatchObject({ status: 409 }); // revoked terminal
  });

  it('lista por entidad; archiva', async () => {
    const before = ((await svc.list('farm', farmId)) as any[]).length;
    const c: any = await svc.create({ entity_type: 'farm', entity_id: farmId, scheme: 'Archivable' });
    expect(((await svc.list('farm', farmId)) as any[]).length).toBe(before + 1);
    await svc.remove(c.id);
    await expect(svc.get(c.id)).rejects.toMatchObject({ status: 404 });
  });
});
