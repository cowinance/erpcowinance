import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';
import { LandService } from './land.service';
import { LotsService } from '../herd/lots.service';
import { HerdService } from '../herd/herd.service';
import type { AnimalWriteService } from '../herd/animal-write.service';

/**
 * Etapa 3 — dividir, fusionar y mover-todo el lote. Todas reusan la regla única `recordMovement`
 * (registran `animal_movements`, transaccional) y respetan las reglas de negocio.
 */
describe('Lotes — dividir / fusionar / mover todo', () => {
  let db: DbService;
  let land: LandService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  const mkLot = async (name: string) => (await lotsSvc.createLot({ name }) as any).id;
  const addAnimals = async (lot: string, n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = (await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id) VALUES ($1,$2,$3,'F','active',$4) RETURNING id`,
        [db.tenant, farmId, speciesId, lot],
      ))[0].id;
      ids.push(id);
    }
    return ids;
  };
  const head = async (lot: string) => (await lotsSvc.getLot(lot) as any).head;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'split-merge-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('mover todo: traslada todos los animales activos al destino y registra el movimiento', async () => {
    const a = await mkLot('MT A');
    const b = await mkLot('MT B');
    await addAnimals(a, 4);
    const res: any = await land.moveAllAnimals(a, { target_lot_id: b }, randomUUID());
    expect(res.moved).toBe(4);
    expect(await head(a)).toBe(0);
    expect(await head(b)).toBe(4);
    const mv = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1 AND to_lot_id=$2`, [db.tenant, b]);
    expect(mv[0].n).toBeGreaterThanOrEqual(4);
  });

  it('dividir: crea un lote nuevo y mueve el subconjunto elegido', async () => {
    const src = await mkLot('DIV src');
    const ids = await addAnimals(src, 6);
    const res: any = await land.splitLot(src, { name: 'DIV nuevo', purpose: 'weaning', animal_ids: ids.slice(0, 2) }, randomUUID());
    expect(res.moved).toBe(2);
    expect(res.new_lot_id).toBeTruthy();
    expect(await head(src)).toBe(4); // quedan 4
    expect(await head(res.new_lot_id)).toBe(2); // 2 en el nuevo
    const nl = await lotsSvc.getLot(res.new_lot_id) as any;
    expect(nl.purpose).toBe('weaning');
  });

  it('fusionar: mueve todo al destino y archiva el lote origen', async () => {
    const from = await mkLot('FUS from');
    const into = await mkLot('FUS into');
    await addAnimals(from, 3);
    await addAnimals(into, 2);
    const res: any = await land.mergeLots(from, { target_lot_id: into }, randomUUID());
    expect(res.merged).toBe(3);
    expect(await head(into)).toBe(5);
    // El lote origen quedó archivado (no aparece en la lista activa).
    const list: any[] = await lotsSvc.lots();
    expect(list.some((l) => l.id === from)).toBe(false);
  });

  it('reglas: no mover/fusionar a un lote archivado ni al mismo lote', async () => {
    const a = await mkLot('R A');
    const archived = await mkLot('R arch');
    await lotsSvc.deleteLot(archived); // vacío → archivado
    await addAnimals(a, 1);
    await expect(land.moveAllAnimals(a, { target_lot_id: archived }, randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(land.mergeLots(a, { target_lot_id: a }, randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(land.splitLot(a, { name: '', animal_ids: [] }, randomUUID())).rejects.toMatchObject({ status: 400 });
  });
});
