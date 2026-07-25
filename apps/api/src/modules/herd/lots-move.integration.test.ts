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
 * Mover animales entre lotes desde el módulo Lotes REUSA la regla única de movimientos (P3,
 * `recordMovement` vía `land.moveAnimals`) — sin UPDATE directo de current_lot_id. Se verifica que el
 * detalle del lote (`getLot`) refleja los movimientos: entre lotes, agregar y quitar.
 */
describe('Lotes — mover animales reusa recordMovement y se refleja en el detalle', () => {
  let db: DbService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let land: LandService;
  let originalCwd: string;
  let tmp: string;
  let lotA: string;
  let lotB: string;
  let animals: string[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lots-move-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    lotA = (await lotsSvc.createLot({ name: 'Mover A' }) as any).id;
    lotB = (await lotsSvc.createLot({ name: 'Mover B' }) as any).id;
    for (let i = 0; i < 3; i++) {
      const id = (await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id) VALUES ($1,$2,$3,'F','active',$4) RETURNING id`,
        [db.tenant, farmId, speciesId, lotA],
      ))[0].id;
      animals.push(id);
    }
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('parte con los 3 animales en el lote A', async () => {
    expect((await lotsSvc.getLot(lotA) as any).head).toBe(3);
    expect((await lotsSvc.getLot(lotB) as any).head).toBe(0);
  });

  it('mover 2 animales de A a B se refleja en ambos detalles', async () => {
    await land.moveAnimals({ animal_ids: animals.slice(0, 2), lot_id: lotB }, randomUUID());
    expect((await lotsSvc.getLot(lotA) as any).head).toBe(1);
    expect((await lotsSvc.getLot(lotB) as any).head).toBe(2);
    // El movimiento quedó registrado (regla única), no fue un UPDATE directo.
    const mv = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1 AND to_lot_id=$2`, [db.tenant, lotB]);
    expect(mv[0].n).toBeGreaterThanOrEqual(2);
  });

  it('quitar del lote (lot_id null) baja las cabezas', async () => {
    await land.moveAnimals({ animal_ids: [animals[2]], lot_id: null }, randomUUID());
    expect((await lotsSvc.getLot(lotA) as any).head).toBe(0);
    const [a] = await db.query<{ lot: string | null }>(`SELECT current_lot_id AS lot FROM animals WHERE id=$1`, [animals[2]]);
    expect(a.lot).toBeNull();
  });
});
