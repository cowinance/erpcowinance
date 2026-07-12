import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Op } from '@cowinance/sync-core';
import { DbService } from '../../../db/db.service';
import { SyncVersionStore } from '../../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../../sync/registry/server-origin-changeset.writer';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { MortalityService } from '../mortality.service';
import { MortalitySyncHandler } from './mortality-sync.handler';

/**
 * Integración del canal sync ENTRANTE de mortalidad (P5-1.b): un `event` op de
 * `mortalities` pasa por la regla única `recordMortality` (origin='sync'), escribiendo
 * atómicamente la fila, status='dead', la versión LWW de status, el timeline y el
 * changeset server-origin; idempotente por mortalityId (=op.rowId); y los rechazos de
 * dominio se devuelven como conflicto sin throw ni escritura parcial. Providers
 * instanciados manualmente (sin DI de Nest), como en P3.
 */
describe('MortalitySyncHandler · integración', () => {
  let db: DbService;
  let handler: MortalitySyncHandler;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  const HLC = '00000000000100:000000:mobile';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'mort-sync-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const mortality = new MortalityService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    handler = new MortalitySyncHandler(db, mortality, new SyncHandlerRegistry());
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const animal = async () =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F','active','born') RETURNING id`,
        [tenantId, farmId, speciesId],
      )
    )[0].id;
  const animalRow = async (id: string) => (await db.query<any>(`SELECT status, status_changed_at FROM animals WHERE id = $1`, [id]))[0];
  const mortRows = async (id: string) => db.query<any>(`SELECT id FROM mortalities WHERE animal_id = $1`, [id]);
  const deathEvents = async (id: string) => db.query<any>(`SELECT id FROM animal_events WHERE animal_id = $1 AND event_type = 'death'`, [id]);
  const changesets = async (mid: string) =>
    db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref = $1`, [`mortality:${mid}`]);
  const mortEvent = (rowId: string, row: Record<string, unknown>): Op => ({ kind: 'event', table: 'mortalities', rowId, row, hlc: HLC });

  it('event op de mortalidad → aplica la regla única (status=dead, versión LWW=HLC, timeline, server-origin); sin conflictos', async () => {
    const a = await animal();
    const op = mortEvent(randomUUID(), { animal_id: a, necropsy: true, notes: 'timpanismo', died_at: new Date().toISOString() });

    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toEqual([]);

    expect(await mortRows(a)).toHaveLength(1);
    expect((await animalRow(a)).status).toBe('dead');
    expect(await deathEvents(a)).toHaveLength(1);

    const v = (await db.query<{ versions: any }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [a]))[0];
    expect(v.versions.status).toBe(HLC);

    const cs = await changesets(op.rowId);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0]).toMatchObject({ kind: 'put', table: 'animals', rowId: a, fields: { status: 'dead' } });
  });

  it('reaplicar el mismo event op (mismo rowId) es idempotente: sin duplicados', async () => {
    const a = await animal();
    const op = mortEvent(randomUUID(), { animal_id: a });
    await db.tx((q) => handler.apply(q, op));
    const again = await db.tx((q) => handler.apply(q, op));
    expect(again).toEqual([]);
    expect(await mortRows(a)).toHaveLength(1);
    expect(await deathEvents(a)).toHaveLength(1);
    expect(await changesets(op.rowId)).toHaveLength(1);
  });

  it('animal ya muerto por OTRA mortalidad → conflicto already_dead, sin escritura parcial', async () => {
    const a = await animal();
    await db.tx((q) => handler.apply(q, mortEvent(randomUUID(), { animal_id: a })));

    const op2 = mortEvent(randomUUID(), { animal_id: a });
    const conflicts = await db.tx((q) => handler.apply(q, op2));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ type: 'semantic', entity_id: a });
    expect(conflicts[0].detail).toContain('mortality.already_dead');
    // Sin escritura parcial de la 2da intención.
    expect(await mortRows(a)).toHaveLength(1);
    expect(await changesets(op2.rowId)).toHaveLength(0);
  });

  it('animal inexistente → conflicto animal.not_found', async () => {
    const op = mortEvent(randomUUID(), { animal_id: randomUUID() });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('animal.not_found');
    expect(await changesets(op.rowId)).toHaveLength(0);
  });

  it('event sin animal_id → conflicto', async () => {
    const op = mortEvent(randomUUID(), { notes: 'sin animal' });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('animal_id');
  });
});
