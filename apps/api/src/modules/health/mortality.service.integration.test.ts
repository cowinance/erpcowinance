import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MortalityService } from './mortality.service';

/**
 * Integración del núcleo neutral de mortalidad (P5-1.a) sobre PGlite en un directorio
 * temporal aislado (providers instanciados manualmente; ver P2/P3). Verifica que una
 * baja produce EXACTAMENTE: una fila mortalities, status='dead' + status_changed_at,
 * versión LWW de status, un evento death de timeline, un changeset server-origin con
 * el put status='dead'; idempotencia por mortalityId (sin duplicar nada); y rechazo
 * semántico (animal inexistente / ya muerto) sin persistencia parcial.
 */
describe('MortalityService · integración', () => {
  let db: DbService;
  let mortality: MortalityService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `MORT-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'mortality-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    mortality = new MortalityService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(tag?: string): Promise<string> {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin)
         VALUES ($1,$2,$3,'F','active','born') RETURNING id`,
        [tenantId, farmId, speciesId],
      )
    )[0].id;
    if (tag) {
      await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    }
    return id;
  }
  const mortRows = async (id: string) =>
    db.query<any>(`SELECT id, died_at, necropsy, estimated_loss, notes FROM mortalities WHERE animal_id = $1`, [id]);
  const animalRow = async (id: string) =>
    (await db.query<any>(`SELECT status, status_changed_at FROM animals WHERE id = $1`, [id]))[0];
  const deathEvents = async (id: string) =>
    db.query<any>(`SELECT payload FROM animal_events WHERE animal_id = $1 AND event_type = 'death'`, [id]);
  const versions = async (id: string) =>
    (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [id]))[0];
  const changesets = async (mid: string) =>
    db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref = $1`, [`mortality:${mid}`]);

  it('baja: una mortalidad, status=dead + status_changed_at, versión, timeline y changeset', async () => {
    const tag = uniq('T');
    const a = await animal(tag);
    const mid = randomUUID();
    const res = await db.tx((q) =>
      mortality.recordMortality(q, {
        animalId: a,
        necropsy: true,
        estimatedLoss: 1200,
        notes: 'neumonía',
        actorUserId: userId,
        origin: 'rest',
        mortalityId: mid,
        emitServerOrigin: true,
      }),
    );
    expect(res.recorded).toBe(true);
    expect(res.mortalityId).toBe(mid);
    expect(res.tag).toBe(tag);

    const m = await mortRows(a);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe(mid);
    expect({ necropsy: m[0].necropsy, loss: Number(m[0].estimated_loss), notes: m[0].notes }).toEqual({ necropsy: true, loss: 1200, notes: 'neumonía' });

    const ar = await animalRow(a);
    expect(ar.status).toBe('dead');
    expect(ar.status_changed_at).toBeTruthy();

    expect(await deathEvents(a)).toHaveLength(1);

    const v = await versions(a);
    expect(v.versions.status).toBeTruthy();

    const cs = await changesets(mid);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0]).toMatchObject({ kind: 'put', table: 'animals', rowId: a, fields: { status: 'dead' } });
  });

  it('reproceso con el mismo mortalityId → no-op idempotente, sin duplicar nada', async () => {
    const a = await animal();
    const mid = randomUUID();
    const input = { animalId: a, actorUserId: userId, origin: 'rest' as const, mortalityId: mid, emitServerOrigin: true };
    const first = await db.tx((q) => mortality.recordMortality(q, input));
    expect(first.recorded).toBe(true);

    const again = await db.tx((q) => mortality.recordMortality(q, input));
    expect(again.recorded).toBe(false);
    expect(again.alreadyRecorded).toBe(true);

    expect(await mortRows(a)).toHaveLength(1);
    expect(await deathEvents(a)).toHaveLength(1);
    expect(await changesets(mid)).toHaveLength(1);
  });

  it('animal ya muerto por OTRA mortalidad → rechazo already_dead sin persistencia parcial', async () => {
    const a = await animal();
    const first = await db.tx((q) =>
      mortality.recordMortality(q, { animalId: a, actorUserId: userId, origin: 'rest', mortalityId: randomUUID(), emitServerOrigin: true }),
    );
    expect(first.recorded).toBe(true);

    const mid2 = randomUUID();
    await expect(
      db.tx((q) => mortality.recordMortality(q, { animalId: a, actorUserId: userId, origin: 'rest', mortalityId: mid2, emitServerOrigin: true })),
    ).rejects.toMatchObject({ response: { code: 'mortality.already_dead' } });

    // Sin persistencia parcial: sigue habiendo una sola mortalidad y ningún changeset de la 2da.
    expect(await mortRows(a)).toHaveLength(1);
    expect(await changesets(mid2)).toHaveLength(0);
  });

  it('animal inexistente → rechazo animal.not_found', async () => {
    const mid = randomUUID();
    await expect(
      db.tx((q) => mortality.recordMortality(q, { animalId: randomUUID(), actorUserId: userId, origin: 'rest', mortalityId: mid, emitServerOrigin: true })),
    ).rejects.toMatchObject({ response: { code: 'animal.not_found' } });
    expect(await changesets(mid)).toHaveLength(0);
  });
});
