import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SemenService } from './semen.service';
import { StrawsService } from './straws.service';

/**
 * Integración de partidas de semen (G-1): CRUD, validación de referencias y saldo de pajuelas como
 * regla única (adjustStraws, sin negativo). `db.tenant` cae al demo.
 */
describe('genetics — semen', () => {
  let db: DbService;
  let svc: SemenService;
  let originalCwd: string;
  let tmp: string;
  let sireId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'semen-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new SemenService(db, new StrawsService(db));
    sireId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND sex='M' AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0]?.id
      ?? (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea una partida (toro interno) y valida batch_code / saldo inicial', async () => {
    const b: any = await svc.create({ batch_code: '  TORO-123  ', sire_id: sireId, straws_available: 20, canister: 'C3' });
    expect(b.batch_code).toBe('TORO-123');
    expect(b.sire_id).toBe(sireId);
    expect(b.straws_available).toBe(20);
    await expect(svc.create({ batch_code: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ batch_code: 'X', straws_available: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ batch_code: 'X', sire_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });

  it('toro externo por nombre (sin sire_id)', async () => {
    const b: any = await svc.create({ batch_code: 'EXT-1', sire_name_external: 'Bull USA 88', straws_available: 5 });
    expect(b.sire_name_external).toBe('Bull USA 88');
    expect(b.sire_id).toBeNull();
  });

  it('saldo de pajuelas como regla única: suma, resta y no-negativo (403)', async () => {
    const b: any = await svc.create({ batch_code: 'SALDO-1', sire_name_external: 'X', straws_available: 10 });
    const add: any = await svc.adjustStraws(b.id, 5, 'acquisition');
    expect(add.straws_available).toBe(15);
    const sub: any = await svc.adjustStraws(b.id, -8, 'insemination');
    expect(sub.straws_available).toBe(7);
    await expect(svc.adjustStraws(b.id, -100, 'insemination')).rejects.toMatchObject({ status: 403 }); // sin negativo
    await expect(svc.adjustStraws(b.id, 0, 'adjustment')).rejects.toMatchObject({ status: 400 });
    await expect(svc.adjustStraws(b.id, -1, 'no-existe')).rejects.toMatchObject({ status: 400 });
    // El saldo quedó en 7 (la resta inválida no se aplicó).
    expect((await svc.get(b.id) as any).straws_available).toBe(7);
  });

  it('edita y archiva', async () => {
    const b: any = await svc.create({ batch_code: 'EDIT-1', sire_name_external: 'Y', straws_available: 3 });
    const upd: any = await svc.update(b.id, { canister: 'C9', unit_cost: 12.5 });
    // `canister` era la ubicación en texto libre; desde GT-2 la real vive en la pajuela y ésta se
    // devuelve como dato heredado, que es la pista para el inventario físico del termo.
    expect(upd.legacy_location).toBe('C9');
    expect(upd.unit_cost).toBe(12.5);
    await svc.remove(b.id);
    await expect(svc.get(b.id)).rejects.toMatchObject({ status: 404 });
  });
});
