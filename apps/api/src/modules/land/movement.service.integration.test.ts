import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';

/**
 * Integración del núcleo neutral de movimientos (P3 M-1.a) sobre PGlite en un
 * directorio temporal aislado (providers instanciados manualmente; ver los tests
 * de P2). Verifica que cada movimiento produce EXACTAMENTE: estado correcto, una
 * fila animal_movements, un evento de timeline, la propagación server-origin y
 * ningún duplicado; el invariante lote–potrero rechaza incoherencias sin
 * persistencia parcial; e idempotencia por movementId.
 */
describe('MovementService · integración', () => {
  let db: DbService;
  let movement: MovementService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `MOV-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'movement-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    movement = new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function paddock(name: string): Promise<string> {
    return (
      await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name])
    )[0].id;
  }
  async function lot(name: string, paddockId: string | null): Promise<string> {
    return (
      await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, current_paddock_id) VALUES ($1,$2,$3,$4) RETURNING id`, [
        tenantId,
        farmId,
        name,
        paddockId,
      ])
    )[0].id;
  }
  async function animal(lotId: string | null, paddockId: string | null): Promise<string> {
    return (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id, current_paddock_id)
         VALUES ($1,$2,$3,'F','active','born',$4,$5) RETURNING id`,
        [tenantId, farmId, speciesId, lotId, paddockId],
      )
    )[0].id;
  }
  const loc = async (id: string) =>
    (await db.query<any>(`SELECT current_lot_id, current_paddock_id FROM animals WHERE id = $1`, [id]))[0];
  const facts = async (id: string) => db.query<any>(`SELECT * FROM animal_movements WHERE animal_id = $1 ORDER BY created_at`, [id]);
  const events = async (id: string) =>
    db.query<any>(`SELECT payload FROM animal_events WHERE animal_id = $1 AND event_type = 'movement'`, [id]);
  const changesets = async (mid: string) =>
    db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref = $1`, [`movement:${mid}`]);

  it('solo-lote: fija lote+potrero derivado, un hecho, un evento, versión y changeset', async () => {
    const pA = await paddock(uniq('A'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(null, null);
    const mid = randomUUID();
    const res = await db.tx((q) =>
      movement.recordMovement(q, { animalIds: [a], to: { lot: lX }, reason: 'test', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true }),
    );
    expect(res.moved).toBe(1);
    expect(await loc(a)).toEqual({ current_lot_id: lX, current_paddock_id: pA });

    const f = await facts(a);
    expect(f).toHaveLength(1);
    expect({ to_lot: f[0].to_lot_id, to_pad: f[0].to_paddock_id, origin: f[0].origin, mid: f[0].movement_id }).toEqual({
      to_lot: lX,
      to_pad: pA,
      origin: 'web',
      mid,
    });
    expect(await events(a)).toHaveLength(1);

    const v = (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [a]))[0];
    expect(v.versions.current_lot_id).toBeTruthy();
    expect(v.versions.current_paddock_id).toBeTruthy();

    const cs = await changesets(mid);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0].fields.current_lot_id).toBe(lX);
  });

  it('grupo con un movementId → un hecho por animal; idempotente al reprocesar', async () => {
    const pA = await paddock(uniq('A'));
    const lX = await lot(uniq('X'), pA);
    const a1 = await animal(null, null);
    const a2 = await animal(null, null);
    const mid = randomUUID();
    const first = await db.tx((q) =>
      movement.recordMovement(q, { animalIds: [a1, a2], to: { lot: lX }, reason: 'rodeo', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true }),
    );
    expect(first.moved).toBe(2);
    expect(await facts(a1)).toHaveLength(1);
    expect(await facts(a2)).toHaveLength(1);

    // Reproceso idempotente: mismo movementId → sin nuevos hechos/eventos/changesets.
    const again = await db.tx((q) =>
      movement.recordMovement(q, { animalIds: [a1, a2], to: { lot: lX }, reason: 'rodeo', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true }),
    );
    expect(again.moved).toBe(0);
    expect(again.skipped).toBe(2);
    expect(await facts(a1)).toHaveLength(1);
    expect(await events(a1)).toHaveLength(1);
    expect(await changesets(mid)).toHaveLength(1);
  });

  it('incoherencia lote–potrero (lote X + potrero B) → rechazo sin persistencia parcial', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(null, null);
    const mid = randomUUID();
    await expect(
      db.tx((q) =>
        movement.recordMovement(q, { animalIds: [a], to: { lot: lX, paddock: pB }, reason: 'x', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true }),
      ),
    ).rejects.toMatchObject({ response: { code: 'movement.lot_paddock_mismatch' } });
    // Rollback total: animal intacto, sin hecho.
    expect(await loc(a)).toEqual({ current_lot_id: null, current_paddock_id: null });
    expect(await facts(a)).toHaveLength(0);
  });

  it('sacar de lote: {lot:null, paddock:B} → sin lote, potrero B, un hecho', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(lX, pA);
    const mid = randomUUID();
    const res = await db.tx((q) =>
      movement.recordMovement(q, { animalIds: [a], to: { lot: null, paddock: pB }, reason: 'hospital', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true }),
    );
    expect(res.moved).toBe(1);
    expect(await loc(a)).toEqual({ current_lot_id: null, current_paddock_id: pB });
    const f = await facts(a);
    expect(f).toHaveLength(1);
    expect({ from_lot: f[0].from_lot_id, to_lot: f[0].to_lot_id, to_pad: f[0].to_paddock_id }).toEqual({ from_lot: lX, to_lot: null, to_pad: pB });
  });

  it('solo-potrero con animal en lote hacia otro potrero → rechazo (no arrastra el lote)', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(lX, pA);
    const mid = randomUUID();
    await expect(
      db.tx((q) => movement.recordMovement(q, { animalIds: [a], to: { paddock: pB }, reason: 'x', actorUserId: userId, origin: 'web', movementId: mid, emitServerOrigin: true })),
    ).rejects.toMatchObject({ response: { code: 'movement.lot_paddock_mismatch' } });
    expect(await loc(a)).toEqual({ current_lot_id: lX, current_paddock_id: pA });
  });
});
