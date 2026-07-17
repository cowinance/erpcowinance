import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Animales E6 — calidad de datos (banderas de completitud/coherencia) y genealogía extendida
 * (ancestros hasta N generaciones + descendencia). No duplica alertas repro/sanidad.
 */
describe('HerdService — calidad de datos + genealogía (E6)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catVaca: string;

  const mk = async (sex: string, categoryId: string, opts: { lot?: string | null; tag?: string; dam?: string; sire?: string } = {}) => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id, current_lot_id, dam_id, sire_id)
         VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8) RETURNING id`,
        [db.tenant, farmId, speciesId, sex, categoryId, opts.lot ?? null, opts.dam ?? null, opts.sire ?? null],
      )
    )[0].id;
    if (opts.tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [db.tenant, id, opts.tag]);
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'quality-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on'; // el seed crea la finca; asserts con >= y tags únicos en genealogía
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    catVaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detecta datos faltantes (sin lote, sin caravana, sin foto)', async () => {
    await mk('F', catVaca, { tag: 'Q-1' }); // sin lote, sin foto, con caravana
    await mk('F', catVaca, {}); // sin lote, sin caravana, sin foto
    const rep: any = await herd.qualityReport();
    const by = Object.fromEntries(rep.issues.map((i: any) => [i.code, i.count]));
    expect(by.no_lot).toBeGreaterThanOrEqual(2);
    expect(by.no_tag).toBeGreaterThanOrEqual(1);
    expect(by.no_photo).toBeGreaterThanOrEqual(2);
    // Cada issue trae etiqueta + muestra de animales.
    const noTag = rep.issues.find((i: any) => i.code === 'no_tag');
    expect(noTag.label).toContain('caravana');
    expect(Array.isArray(noTag.animals)).toBe(true);
  });

  it('detecta sexo incoherente con la categoría', async () => {
    await mk('M', catVaca, { tag: 'Q-M' }); // macho en categoría 'vaca' (sex F)
    const rep: any = await herd.qualityReport();
    const mismatch = rep.issues.find((i: any) => i.code === 'sex_category_mismatch');
    expect(mismatch.count).toBeGreaterThanOrEqual(1);
  });

  it('arma la genealogía extendida (ancestros 2 generaciones + descendencia)', async () => {
    const granddam = await mk('F', catVaca, { tag: 'GD' });
    const dam = await mk('F', catVaca, { tag: 'DAM', dam: granddam });
    const calf = await mk('F', catVaca, { tag: 'CALF', dam });
    const g: any = await herd.animalGenealogy(calf, 3);
    const tags = g.ancestors.map((a: any) => a.tag);
    expect(tags).toContain('DAM'); // madre (gen 1)
    expect(tags).toContain('GD'); // abuela materna (gen 2)
    const genOf = Object.fromEntries(g.ancestors.map((a: any) => [a.tag, a.generation]));
    expect(genOf['DAM']).toBe(1);
    expect(genOf['GD']).toBe(2);
    // La descendencia de la madre incluye al ternero.
    const gd: any = await herd.animalGenealogy(dam);
    expect(gd.offspring.map((o: any) => o.tag)).toContain('CALF');
  });
});
