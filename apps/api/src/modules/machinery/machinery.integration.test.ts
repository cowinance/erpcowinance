import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { MachineryService } from './machinery.service';

/**
 * Integración de maquinaria (MQ-1): CRUD, validaciones y máquina de estados. `db.tenant` cae al demo.
 */
describe('machinery — maestro', () => {
  let db: DbService;
  let svc: MachineryService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'machinery-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new MachineryService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea una máquina (valida nombre y type) con finca por defecto', async () => {
    const m: any = await svc.create({ name: '  John Deere 5075  ', type: 'tractor', make: 'John Deere', year: 2019, engine_hours: 1200 });
    expect(m.name).toBe('John Deere 5075');
    expect(m.type).toBe('tractor');
    expect(m.status).toBe('active');
    await expect(svc.create({ name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ name: 'X', type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('máquina de estados: active→maintenance→active; →retired terminal', async () => {
    const m: any = await svc.create({ name: 'Cosechadora', type: 'harvester' });
    const mnt: any = await svc.updateStatus(m.id, 'maintenance');
    expect(mnt.status).toBe('maintenance');
    const back: any = await svc.updateStatus(m.id, 'active');
    expect(back.status).toBe('active');
    const ret: any = await svc.updateStatus(m.id, 'retired');
    expect(ret.status).toBe('retired');
    await expect(svc.updateStatus(m.id, 'active')).rejects.toMatchObject({ status: 409 }); // retired terminal
  });

  it('lista por estado; edita horas/km; archiva', async () => {
    const m: any = await svc.create({ name: 'Camioneta', type: 'truck' });
    const upd: any = await svc.update(m.id, { odometer_km: 85000, plate: 'AB123CD' });
    expect(upd.odometer_km).toBe(85000);
    expect(upd.plate).toBe('AB123CD');
    expect((await svc.list('active')).some((x: any) => x.id === m.id)).toBe(true);
    await svc.remove(m.id);
    await expect(svc.get(m.id)).rejects.toMatchObject({ status: 404 });
  });
});
