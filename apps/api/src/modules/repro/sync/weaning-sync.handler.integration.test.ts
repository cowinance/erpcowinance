import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Op } from '@cowinance/sync-core';
import { DbService } from '../../../db/db.service';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { WeaningService } from '../weaning.service';
import { WeaningSyncHandler } from './weaning-sync.handler';

/**
 * Integración del canal sync ENTRANTE de destete (P5-1.c): un `event` op de `weanings`
 * pasa por la regla única `recordWeaning` (origin='sync'), materializando el hecho, el
 * pesaje asociado (con identidad determinista) y el timeline; idempotente por weaningId
 * (=op.rowId); y el rechazo de dominio se devuelve como conflicto sin throw ni escritura
 * parcial. Providers instanciados manualmente (sin DI de Nest).
 */
describe('WeaningSyncHandler · integración', () => {
  let db: DbService;
  let handler: WeaningSyncHandler;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  const HLC = '00000000000100:000000:mobile';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'wean-sync-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    handler = new WeaningSyncHandler(db, new WeaningService(db), new SyncHandlerRegistry());
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
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','active','born') RETURNING id`,
        [tenantId, farmId, speciesId],
      )
    )[0].id;
  const weanRows = async (id: string) => db.query<any>(`SELECT id FROM weanings WHERE animal_id = $1`, [id]);
  const weighRows = async (id: string) => db.query<any>(`SELECT id FROM weighings WHERE animal_id = $1`, [id]);
  const weanEvents = async (id: string) => db.query<any>(`SELECT id FROM animal_events WHERE animal_id = $1 AND event_type = 'weaning'`, [id]);
  const weanEvent = (rowId: string, row: Record<string, unknown>): Op => ({ kind: 'event', table: 'weanings', rowId, row, hlc: HLC });

  it('event op de destete con peso → aplica la regla única (weaning + pesaje id=rowId + timeline); sin conflictos', async () => {
    const a = await animal();
    const op = weanEvent(randomUUID(), { animal_id: a, weight_kg: 190, weaning_date: new Date().toISOString() });

    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toEqual([]);
    expect(await weanRows(a)).toHaveLength(1);
    const wg = await weighRows(a);
    expect(wg).toHaveLength(1);
    expect(wg[0].id).toBe(op.rowId); // identidad determinista del pesaje
    expect(await weanEvents(a)).toHaveLength(1);
  });

  it('reaplicar el mismo event op (mismo rowId) es idempotente: sin duplicados', async () => {
    const a = await animal();
    const op = weanEvent(randomUUID(), { animal_id: a, weight_kg: 175 });
    await db.tx((q) => handler.apply(q, op));
    const again = await db.tx((q) => handler.apply(q, op));
    expect(again).toEqual([]);
    expect(await weanRows(a)).toHaveLength(1);
    expect(await weighRows(a)).toHaveLength(1);
    expect(await weanEvents(a)).toHaveLength(1);
  });

  it('animal inexistente → conflicto animal.not_found', async () => {
    const op = weanEvent(randomUUID(), { animal_id: randomUUID(), weight_kg: 100 });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('animal.not_found');
  });

  it('event sin animal_id → conflicto', async () => {
    const op = weanEvent(randomUUID(), { weight_kg: 100 });
    const conflicts = await db.tx((q) => handler.apply(q, op));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('animal_id');
  });
});
