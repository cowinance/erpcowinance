import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';
import { LandService } from './land.service';

/**
 * Editor de mapas (D3): alta/edición/baja de potreros con geometría. La superficie se DERIVA del
 * polígono dibujado (shoelace, regla única del dominio), y la baja se bloquea si hay animales.
 */
describe('LandService — editor de potreros', () => {
  let db: DbService;
  let land: LandService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  const square = (s: number) => ({ type: 'Polygon', coordinates: [[[0, 0], [s, 0], [s, s], [0, s]]] });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'paddock-editor-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un potrero con forma y deriva la superficie del polígono', async () => {
    const p: any = await land.createPaddock({ name: 'Editor 1', pasture_type: 'natural', boundary: square(100) });
    expect(p.area_ha).toBe(9); // 100×100 u² × 3² m²/u² = 9 ha
    expect(p.boundary.coordinates[0]).toHaveLength(4);
    const list: any[] = await land.paddocks();
    expect(list.some((x) => x.id === p.id && x.boundary?.coordinates?.length)).toBe(true);
  });

  it('editar la forma re-deriva la superficie; editar props no la toca', async () => {
    const p: any = await land.createPaddock({ name: 'Editor 2', boundary: square(100) });
    const bigger: any = await land.updatePaddock(p.id, { boundary: square(200) });
    expect(bigger.area_ha).toBe(36); // 200×200 × 9 = 36 ha
    const renamed: any = await land.updatePaddock(p.id, { name: 'Editor 2 bis', pasture_type: 'alfalfa' });
    expect(renamed.name).toBe('Editor 2 bis');
    expect(renamed.area_ha).toBe(36); // sin tocar la forma, el área queda
  });

  it('rechaza una geometría inválida (< 3 vértices)', async () => {
    await expect(land.createPaddock({ name: 'Malo', boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } })).rejects.toMatchObject({ status: 400 });
  });

  it('borra un potrero vacío pero bloquea uno con animales', async () => {
    const empty: any = await land.createPaddock({ name: 'Vacío', boundary: square(50) });
    await expect(land.deletePaddock(empty.id)).resolves.toMatchObject({ deleted: true });
    const list: any[] = await land.paddocks();
    expect(list.some((x) => x.id === empty.id)).toBe(false);

    const occupied: any = await land.createPaddock({ name: 'Ocupado', boundary: square(60) });
    await db.query(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_paddock_id) VALUES ($1,$2,$3,'F','active',$4)`,
      [db.tenant, farmId, speciesId, occupied.id],
    );
    await expect(land.deletePaddock(occupied.id)).rejects.toMatchObject({ status: 409 });
  });
});
