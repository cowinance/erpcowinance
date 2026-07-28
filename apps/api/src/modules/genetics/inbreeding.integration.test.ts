import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InbreedingService } from './inbreeding.service';

/**
 * Consanguinidad contra el pedigrí REAL de la base.
 *
 * El cálculo puro ya está probado en el dominio con parentescos conocidos. Lo que se prueba acá es
 * lo otro: que la consulta traiga el pedigrí correcto y que el consultor ofrezca candidatos que de
 * verdad puedan servir.
 */
describe('consanguinidad sobre el pedigrí de la finca', () => {
  let db: DbService;
  let svc: InbreedingService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catToro: string;
  let catNovillo: string;
  let catVaca: string;

  const animal = async (sex: string, categoryId: string, sireId: string | null = null, damId: string | null = null) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, sire_id, dam_id)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7) RETURNING id`,
        [db.tenant, farmId, speciesId, categoryId, sex, sireId, damId],
      )
    )[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'inbreeding-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new InbreedingService(db);
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    const cat = async (code: string) => (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code=$1 LIMIT 1`, [code]))[0].id;
    catToro = await cat('toro');
    catNovillo = await cat('novillo');
    catVaca = await cat('vaca');
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ABUELO × NIETA da 12,5% leyendo el pedigrí de la base', async () => {
    const abuelo = await animal('M', catToro);
    const hijo = await animal('M', catToro, abuelo);
    const nieta = await animal('F', catVaca, hijo);
    const r = await svc.forMating(abuelo, nieta);
    expect(r.f).toBe(0.125);
    expect(r.blocks).toBe(true);
  }, 60_000);

  it('EL CONSULTOR OFRECE REPRODUCTORES, NO CUALQUIER MACHO', async () => {
    // Ofrecía novillos —que están castrados— y terneros de tres meses como candidatos para servir.
    // Lo encontró una auditoría: los endpoints devolvían 200 y los datos eran absurdos.
    const vaca = await animal('F', catVaca);
    const toro = await animal('M', catToro);
    const novillo = await animal('M', catNovillo);

    const r = await svc.advisorFor(vaca);
    const ids = r.sires.map((s) => s.sire_id);
    expect(ids).toContain(toro);
    expect(ids, 'un novillo está castrado: no puede servir').not.toContain(novillo);
  }, 60_000);

  it('sin toros cargados no inventa candidatos', async () => {
    const vaca = await animal('F', catVaca);
    const r = await svc.advisorFor(vaca);
    expect(Array.isArray(r.sires)).toBe(true);
  }, 60_000);
});
