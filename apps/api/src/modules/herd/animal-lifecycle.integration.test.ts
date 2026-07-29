import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { AnimalStatusService } from './animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';

/**
 * Animales E5 — ciclo de vida (descarte/pérdida/transferencia vía AnimalStatusService, regla única)
 * y acciones masivas (estado + categoría). Bloqueo de sold/dead (van por Ventas/Mortalidad).
 */
describe('Animales — ciclo de vida + acciones masivas (E5)', () => {
  let db: DbService;
  let herd: HerdService;
  let status: AnimalStatusService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catVaca: string;
  let catVaquillona: string;
  let catToro: string;

  const mk = async (sex: string, categoryId: string) => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [db.tenant, farmId, speciesId, sex, categoryId],
      )
    )[0].id;
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lifecycle-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    herd = new HerdService(db, writer, new BillingService(db));
    status = new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    // Species DERIVADO de la categoría (vaca/vaquillona/toro comparten especie): evita el flake de
    // `species LIMIT 1` sin ORDER BY vs el species de la categoría (bulkChangeCategory valida que coincidan).
    const vaca = (await db.query<{ id: string; species_id: string }>(`SELECT id, species_id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0];
    speciesId = vaca.species_id;
    catVaca = vaca.id;
    catVaquillona = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaquillona' LIMIT 1`))[0].id;
    catToro = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='toro' LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const statusOf = async (id: string) => (await db.query<{ status: string }>(`SELECT status FROM animals WHERE id=$1`, [id]))[0].status;

  it('descarta un animal (status culled + evento cull)', async () => {
    const id = await mk('F', catVaca);
    const res = await status.changeStatus(id, { toStatus: 'culled', reason: 'baja producción' });
    expect(res.changed).toBe(true);
    expect(await statusOf(id)).toBe('culled');
    const tl: any[] = await herd.timeline(id);
    expect(tl.some((e) => e.event_type === 'cull' && e.payload?.reason === 'baja producción')).toBe(true);
  });

  it('no permite cambiar un animal no activo', async () => {
    const id = await mk('F', catVaca);
    await status.changeStatus(id, { toStatus: 'lost' });
    await expect(status.changeStatus(id, { toStatus: 'culled' })).rejects.toThrow();
  });

  it('rechaza estados con flujo dedicado (sold/dead)', async () => {
    const id = await mk('F', catVaca);
    await expect(status.changeStatus(id, { toStatus: 'sold' })).rejects.toThrow();
    await expect(status.changeStatus(id, { toStatus: 'dead' })).rejects.toThrow();
  });

  it('cambio de estado masivo: cuenta cambiados y omite no-activos', async () => {
    const a = await mk('F', catVaca);
    const b = await mk('F', catVaca);
    await status.changeStatus(b, { toStatus: 'lost' }); // ya no activo
    const res = await status.bulkChangeStatus([a, b], { toStatus: 'culled', reason: 'plan de descarte' });
    expect(res.changed).toBe(1);
    expect(res.skipped).toBe(1);
    expect(await statusOf(a)).toBe('culled');
  });

  it('cambio de categoría masivo: aplica y omite sexo/especie incompatible', async () => {
    const hembra = await mk('F', catVaquillona);
    const macho = await mk('M', catToro);
    const res = await herd.bulkChangeCategory([hembra, macho], 'vaca'); // vaca = hembra
    expect(res.changed).toBe(1); // solo la hembra
    expect(res.skipped).toBe(1); // el macho no encaja
    const cat = (await db.query<{ code: string }>(`SELECT c.code FROM animals a JOIN animal_categories c ON c.id=a.category_id WHERE a.id=$1`, [hembra]))[0].code;
    expect(cat).toBe('vaca');
  });
});
