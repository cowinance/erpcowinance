import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';
import { LandService } from '../land/land.service';
import { LotsService } from './lots.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Etapa 1 — consistencia de movimientos + trazabilidad. Cambiar el potrero de un lote con animales es
 * una ROTACIÓN (reusa recordMovement: el lote cambia de potrero y los animales lo siguen, con
 * historial). No se mueve a lotes archivados. El historial se arma de `animal_movements` (real).
 */
describe('Lotes — rotación de potrero, guarda de archivado e historial', () => {
  let db: DbService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let land: LandService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let padA: string;
  let padB: string;
  let lot: string;
  const animals: string[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lots-rot-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    const pads = await db.query<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT 2`, [db.tenant]);
    padA = pads[0].id;
    padB = pads[1].id;
    lot = (await lotsSvc.createLot({ name: 'Rotación L' }) as any).id;
    await db.query(`UPDATE lots SET current_paddock_id=$2 WHERE id=$1`, [lot, padA]);
    for (let i = 0; i < 2; i++) {
      const id = (await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id, current_paddock_id) VALUES ($1,$2,$3,'F','active',$4,$5) RETURNING id`,
        [db.tenant, farmId, speciesId, lot, padA],
      ))[0].id;
      animals.push(id);
    }
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rotar el lote a otro potrero mueve al lote y a sus animales, con movimiento registrado', async () => {
    const res: any = await land.moveLot(padB, { lot_id: lot });
    expect(res.moved).toBe(2);
    const [l] = await db.query<{ p: string }>(`SELECT current_paddock_id AS p FROM lots WHERE id=$1`, [lot]);
    expect(l.p).toBe(padB); // el lote cambió de potrero
    const inB = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals WHERE current_lot_id=$1 AND current_paddock_id=$2`, [lot, padB]);
    expect(inB[0].n).toBe(2); // los animales siguieron al lote
    const mv = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1 AND to_paddock_id=$2 AND from_paddock_id=$3`, [db.tenant, padB, padA]);
    expect(mv[0].n).toBeGreaterThanOrEqual(2); // quedó historial real
  });

  it('no permite mover animales a un lote archivado', async () => {
    const archived = (await lotsSvc.createLot({ name: 'Archivado' }) as any).id;
    await lotsSvc.deleteLot(archived); // vacío → se archiva
    await expect(land.moveAnimals({ animal_ids: [animals[0]], lot_id: archived }, randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('el historial del lote refleja la rotación (from/to potrero, cantidad)', async () => {
    const hist: any[] = await lotsSvc.lotHistory(lot);
    const rot = hist.find((h) => h.kind === 'rotacion');
    expect(rot).toBeDefined();
    expect(rot.animals).toBe(2);
    expect(rot.to_paddock).toBeTruthy();
  });
});
