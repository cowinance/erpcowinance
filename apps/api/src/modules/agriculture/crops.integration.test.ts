import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CropsService } from './crops.service';

/**
 * Integración de cultivos (AG-1): CRUD, validación de paddock/crop_type y máquina de estados.
 * `db.tenant` cae al demo (que tiene paddocks sembrados).
 */
describe('agriculture — cultivos', () => {
  let db: DbService;
  let crops: CropsService;
  let originalCwd: string;
  let tmp: string;
  let paddockId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'crops-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    crops = new CropsService(db);
    paddockId = (await db.query<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un cultivo (valida paddock y crop_type)', async () => {
    const c: any = await crops.create({ paddock_id: paddockId, crop_type: '  Maíz  ', variety: 'DK 72', area_ha: 45.5, planting_date: '2030-09-15' });
    expect(c.crop_type).toBe('Maíz');
    expect(c.status).toBe('planned');
    expect(c.area_ha).toBe(45.5);
    await expect(crops.create({ paddock_id: paddockId, crop_type: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(crops.create({ crop_type: 'X' })).rejects.toMatchObject({ status: 400 }); // sin paddock
    await expect(crops.create({ paddock_id: '00000000-0000-0000-0000-000000000000', crop_type: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('máquina de estados: planned→growing→harvested; transición inválida → 409', async () => {
    const c: any = await crops.create({ paddock_id: paddockId, crop_type: 'Soja' });
    // planned → harvested no está permitido.
    await expect(crops.updateStatus(c.id, 'harvested')).rejects.toMatchObject({ status: 409 });
    const g: any = await crops.updateStatus(c.id, 'growing');
    expect(g.status).toBe('growing');
    const h: any = await crops.updateStatus(c.id, 'harvested');
    expect(h.status).toBe('harvested');
    // harvested es terminal.
    await expect(crops.updateStatus(c.id, 'failed')).rejects.toMatchObject({ status: 409 });
  });

  it('planned/growing → failed; listar por estado', async () => {
    const c: any = await crops.create({ paddock_id: paddockId, crop_type: 'Trigo' });
    const f: any = await crops.updateStatus(c.id, 'failed');
    expect(f.status).toBe('failed');
    const failed = await crops.list('failed');
    expect(failed.some((x: any) => x.id === c.id)).toBe(true);
    expect((await crops.list('planned')).some((x: any) => x.id === c.id)).toBe(false);
  });

  it('edita y archiva', async () => {
    const c: any = await crops.create({ paddock_id: paddockId, crop_type: 'Girasol' });
    const upd: any = await crops.update(c.id, { variety: 'Alto oleico', area_ha: 30 });
    expect(upd.variety).toBe('Alto oleico');
    expect(upd.area_ha).toBe(30);
    await crops.remove(c.id);
    await expect(crops.get(c.id)).rejects.toMatchObject({ status: 404 });
  });
});
