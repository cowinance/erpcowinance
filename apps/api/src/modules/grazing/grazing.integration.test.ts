import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { GrazingService } from './grazing.service';

/**
 * Integración de pastoreo (PG-1): entrada/salida con las reglas de rotación (un potrero ocupado y un
 * lote que ya pastorea rechazan la entrada) y los derivados (días, forraje). `db.tenant` cae al demo.
 */
describe('grazing — pastoreo', () => {
  let db: DbService;
  let svc: GrazingService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let padA: string;
  let padB: string;
  let lot1: string;
  let lot2: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'grazing-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new GrazingService(db);
    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const mkPaddock = async (name: string) => (await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
    const mkLot = async (name: string) => (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
    padA = await mkPaddock('Potrero A');
    padB = await mkPaddock('Potrero B');
    lot1 = await mkLot('Lote 1');
    lot2 = await mkLot('Lote 2');
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('entrada: nace abierto con forraje pre; días null mientras abierto', async () => {
    const g: any = await svc.enter({ paddock_id: padA, lot_id: lot1, entry_date: '2030-05-01', pre_grazing_kg_dm_ha: 3000 });
    expect(g.is_open).toBe(true);
    expect(g.grazing_days).toBeNull();
    expect(g.pre_grazing_kg_dm_ha).toBe(3000);
  });

  it('rotación: potrero ocupado → 409; lote que ya pastorea → 409', async () => {
    await expect(svc.enter({ paddock_id: padA, lot_id: lot2 })).rejects.toMatchObject({ status: 409 }); // A ocupado por lote 1
    await expect(svc.enter({ paddock_id: padB, lot_id: lot1 })).rejects.toMatchObject({ status: 409 }); // lote 1 ya pastorea
  });

  it('salida: cierra, calcula días y forraje consumido (derivados)', async () => {
    const [open]: any = await svc.list(padA, lot1);
    const closed: any = await svc.exit(open.id, { exit_date: '2030-05-08', post_grazing_kg_dm_ha: 1200 });
    expect(closed.is_open).toBe(false);
    expect(closed.grazing_days).toBe(7);
    expect(closed.forage_consumed_kg_dm_ha).toBe(1800); // 3000 − 1200
    // Cerrado el pastoreo, el potrero se libera: el lote 2 ya puede entrar.
    const g2: any = await svc.enter({ paddock_id: padA, lot_id: lot2, entry_date: '2030-05-09' });
    expect(g2.is_open).toBe(true);
  });

  it('salida inválida: exit < entry → 400; cerrar dos veces → 409', async () => {
    const g: any = await svc.enter({ paddock_id: padB, lot_id: lot1, entry_date: '2030-06-01' });
    await expect(svc.exit(g.id, { exit_date: '2030-05-01' })).rejects.toMatchObject({ status: 400 });
    await svc.exit(g.id, { exit_date: '2030-06-05' });
    await expect(svc.exit(g.id, { exit_date: '2030-06-06' })).rejects.toMatchObject({ status: 409 });
  });

  it('potrero/lote inexistente → 404', async () => {
    await expect(svc.enter({ paddock_id: '00000000-0000-0000-0000-000000000000', lot_id: lot1 })).rejects.toMatchObject({ status: 404 });
    await expect(svc.enter({ paddock_id: padB, lot_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });
});
