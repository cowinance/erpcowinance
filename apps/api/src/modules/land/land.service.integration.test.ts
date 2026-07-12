import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';
import { LandService } from './land.service';

/**
 * Caracterización de `land.moveLot` tras delegar en MovementService (P3 M-1.b.1):
 * mismo contrato observable que antes (potrero de los animales, un hecho y un
 * evento por animal, respuesta {moved,lot,from,to}, guardias) MÁS la propagación
 * server-origin nueva y la atomicidad (rollback del lote si falla el movimiento).
 * Providers instanciados manualmente (sin DI de Nest), como en M-1.a.
 */
describe('LandService.moveLot · caracterización', () => {
  let db: DbService;
  let land: LandService;
  let movement: MovementService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `LND-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'land-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    movement = new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    land = new LandService(db, movement);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => vi.restoreAllMocks());

  const paddock = async (name: string) =>
    (await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
  const lot = async (name: string, paddockId: string | null) =>
    (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, current_paddock_id) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, name, paddockId]))[0].id;
  const animal = async (lotId: string, paddockId: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id, current_paddock_id)
         VALUES ($1,$2,$3,'F','active','born',$4,$5) RETURNING id`,
        [tenantId, farmId, speciesId, lotId, paddockId],
      )
    )[0].id;
  const loc = async (id: string) => (await db.query<any>(`SELECT current_lot_id, current_paddock_id FROM animals WHERE id = $1`, [id]))[0];
  const facts = async (id: string) => db.query<any>(`SELECT * FROM animal_movements WHERE animal_id = $1`, [id]);
  const events = async (id: string) => db.query<any>(`SELECT id FROM animal_events WHERE animal_id = $1 AND event_type = 'movement'`, [id]);

  it('mueve el lote: animales al nuevo potrero (lote intacto), un hecho y un evento por animal, y respuesta', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const a1 = await animal(lX, pA);
    const a2 = await animal(lX, pA);

    const res = await land.moveLot(pB, { lot_id: lX });
    expect(res.moved).toBe(2);
    expect(res.to).toBeTruthy();

    // Lote reubicado; animales siguen en el lote pero en el nuevo potrero.
    expect((await db.query<any>(`SELECT current_paddock_id FROM lots WHERE id = $1`, [lX]))[0].current_paddock_id).toBe(pB);
    for (const a of [a1, a2]) {
      expect(await loc(a)).toEqual({ current_lot_id: lX, current_paddock_id: pB });
      const f = await facts(a);
      expect(f).toHaveLength(1);
      expect({ from: f[0].from_paddock_id, to: f[0].to_paddock_id, origin: f[0].origin, reason: f[0].reason }).toEqual({
        from: pA,
        to: pB,
        origin: 'map',
        reason: 'rotación',
      });
      expect(await events(a)).toHaveLength(1);
    }

    // Propagación server-origin: UN changeset con los put de current_paddock_id.
    const cs = await db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref LIKE 'movement:%'`);
    expect(cs.length).toBeGreaterThanOrEqual(1);
    const ops = cs.flatMap((c: any) => c.operations.ops);
    expect(ops.some((o: any) => o.rowId === a1 && o.fields.current_paddock_id === pB)).toBe(true);
  });

  it('lote vacío → moved:0, potrero del lote actualizado, sin hechos', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const res = await land.moveLot(pB, { lot_id: lX });
    expect(res.moved).toBe(0);
    expect((await db.query<any>(`SELECT current_paddock_id FROM lots WHERE id = $1`, [lX]))[0].current_paddock_id).toBe(pB);
  });

  it('lote ya en el potrero → move.already_there (400)', async () => {
    const pA = await paddock(uniq('A'));
    const lX = await lot(uniq('X'), pA);
    await expect(land.moveLot(pA, { lot_id: lX })).rejects.toMatchObject({ response: { code: 'move.already_there' } });
  });

  it('atomicidad: si el movimiento animal falla, el lote NO queda movido', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    await animal(lX, pA);
    vi.spyOn(movement, 'recordMovement').mockRejectedValueOnce(new Error('fallo simulado'));
    await expect(land.moveLot(pB, { lot_id: lX })).rejects.toThrow();
    // Rollback total: el lote sigue en su potrero original.
    expect((await db.query<any>(`SELECT current_paddock_id FROM lots WHERE id = $1`, [lX]))[0].current_paddock_id).toBe(pA);
  });
});
