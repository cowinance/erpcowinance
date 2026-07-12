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
import { MovementService } from '../movement.service';
import { MovementSyncHandler } from './movement-sync.handler';

/**
 * Integración del canal sync ENTRANTE de movimientos (P3 M-1.c.1): un `event` op de
 * `animal_movements` pasa por la regla única `recordMovement` (origin='sync'),
 * proyectando el campo (LWW), el hecho y el timeline; idempotente por movementId; y
 * las incoherencias se devuelven como conflicto sin throw ni escritura parcial.
 * Providers instanciados manualmente (sin DI de Nest), como en M-1.a/M-1.b.
 */
describe('MovementSyncHandler · integración', () => {
  let db: DbService;
  let handler: MovementSyncHandler;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `SYNC-${p}-${Date.now()}-${seq++}`;
  const HLC = '00000000000100:000000:mobile';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'mov-sync-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const movement = new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    handler = new MovementSyncHandler(db, movement, new SyncHandlerRegistry());
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const paddock = async (name: string) =>
    (await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
  const lot = async (name: string, paddockId: string | null) =>
    (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, current_paddock_id) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, farmId, name, paddockId]))[0].id;
  const animal = async (lotId: string | null, paddockId: string | null) =>
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
  const movEvent = (rowId: string, row: Record<string, unknown>): Op => ({ kind: 'event', table: 'animal_movements', rowId, row, hlc: HLC });

  it('event op de movimiento → aplica la regla única (campo LWW, hecho, timeline); sin conflictos', async () => {
    const pA = await paddock(uniq('A'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(null, null);
    const op = movEvent(randomUUID(), { animal_id: a, to_lot_id: lX, reason: 'destete', moved_at: new Date().toISOString() });

    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toEqual([]);
    expect(await loc(a)).toEqual({ current_lot_id: lX, current_paddock_id: pA });
    const f = await facts(a);
    expect(f).toHaveLength(1);
    expect({ to_lot: f[0].to_lot_id, origin: f[0].origin, mid: f[0].movement_id }).toEqual({ to_lot: lX, origin: 'sync', mid: op.rowId });
    expect(await events(a)).toHaveLength(1);
    const v = (await db.query<{ versions: any }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [a]))[0];
    expect(v.versions.current_lot_id).toBe(HLC);
  });

  it('reaplicar el mismo event op (mismo rowId) es idempotente: sin duplicados', async () => {
    const pA = await paddock(uniq('A'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(null, null);
    const op = movEvent(randomUUID(), { animal_id: a, to_lot_id: lX, reason: 'x' });
    await db.tx((q) => handler.apply(q, op));
    const again = await db.tx((q) => handler.apply(q, op));
    expect(again).toEqual([]);
    expect(await facts(a)).toHaveLength(1);
    expect(await events(a)).toHaveLength(1);
  });

  it('movimiento incoherente (lote X + potrero B) → conflicto, sin escritura parcial', async () => {
    const pA = await paddock(uniq('A'));
    const pB = await paddock(uniq('B'));
    const lX = await lot(uniq('X'), pA);
    const a = await animal(null, null);
    const op = movEvent(randomUUID(), { animal_id: a, to_lot_id: lX, to_paddock_id: pB, reason: 'x' });

    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ type: 'semantic', entity_id: a });
    expect(conflicts[0].detail).toContain('movement.lot_paddock_mismatch');
    // No se aplicó nada.
    expect(await loc(a)).toEqual({ current_lot_id: null, current_paddock_id: null });
    expect(await facts(a)).toHaveLength(0);
  });

  it('event sin destino → conflicto movement.noop', async () => {
    const a = await animal(null, null);
    const op = movEvent(randomUUID(), { animal_id: a, reason: 'x' });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('movement.noop');
  });

  it('event sin animal_id → conflicto', async () => {
    const op = movEvent(randomUUID(), { to_lot_id: 'x', reason: 'x' });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('animal_id');
  });
});
