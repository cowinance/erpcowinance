import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Etapa 2 — filtros y paginación de animales (para la lista del lote). Se extendió `listAnimals` con
 * sexo, peso (última pesada) y edad (meses desde birth_date). Datos controlados para asserts exactos.
 */
describe('HerdService.listAnimals — filtros sexo/peso/edad + paginación', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let lot: string;

  const monthsAgo = (m: number) => new Date(Date.now() - m * 30.44 * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'filters-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    lot = (await herd.createLot({ name: 'Filtros L' }) as any).id;
    const mk = async (sex: string, kg: number, ageMo: number) => {
      const id = (await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id, birth_date) VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING id`,
        [db.tenant, farmId, speciesId, sex, lot, monthsAgo(ageMo)],
      ))[0].id;
      await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,'2030-06-01',$3)`, [db.tenant, id, kg]);
      return id;
    };
    await mk('F', 400, 36); // A1: hembra, liviana, 3 años
    await mk('M', 600, 12); // A2: macho, pesado, 1 año
    await mk('F', 500, 60); // A3: hembra, media, 5 años
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const count = async (params: any) => ((await herd.listAnimals({ lot, ...params })) as any).data.length;

  it('filtra por sexo', async () => {
    expect(await count({ sex: 'F' })).toBe(2);
    expect(await count({ sex: 'M' })).toBe(1);
  });

  it('filtra por peso (última pesada)', async () => {
    expect(await count({ minWeight: 550 })).toBe(1); // 600
    expect(await count({ maxWeight: 450 })).toBe(1); // 400
    expect(await count({ minWeight: 450, maxWeight: 550 })).toBe(1); // 500
  });

  it('filtra por edad en meses', async () => {
    expect(await count({ minAgeMonths: 48 })).toBe(1); // 60 mo
    expect(await count({ maxAgeMonths: 24 })).toBe(1); // 12 mo
  });

  it('pagina con cursor', async () => {
    const p1: any = await herd.listAnimals({ lot, limit: 2 });
    expect(p1.data).toHaveLength(2);
    expect(p1.next_cursor).toBeTruthy();
    const p2: any = await herd.listAnimals({ lot, limit: 2, cursor: p1.next_cursor });
    expect(p2.data).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();
    // Sin solapamiento entre páginas.
    const ids = new Set([...p1.data, ...p2.data].map((a: any) => a.id));
    expect(ids.size).toBe(3);
  });
});
