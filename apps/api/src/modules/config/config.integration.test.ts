import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CatalogsService } from './catalogs.service';

/**
 * Integración de Configuración (A3 · catálogos maestros): lectura de catálogos globales + extensión por
 * tenant de razas/diagnósticos, con validación de dominio, unicidad (409) y protección del catálogo
 * base (no se borran las entradas globales). `db.tenant` cae al demo (que trae razas globales sembradas).
 */
describe('config — catálogos maestros', () => {
  let db: DbService;
  let svc: CatalogsService;
  let originalCwd: string;
  let tmp: string;
  let speciesId: string;
  let globalBreedId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'config-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new CatalogsService(db);
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE deleted_at IS NULL LIMIT 1`))[0].id;
    globalBreedId = (await db.query<{ id: string }>(`SELECT id FROM breeds WHERE tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lista catálogos: globales y base de razas marcada no editable', async () => {
    const cat: any = await svc.catalogs();
    expect(cat.species.length).toBeGreaterThan(0);
    expect(cat.units.length).toBeGreaterThan(0);
    expect(cat.categories.length).toBeGreaterThan(0);
    const base = cat.breeds.find((b: any) => b.id === globalBreedId);
    expect(base.editable).toBe(false); // raza del catálogo base
  });

  it('crea una raza propia del tenant (editable) y aparece en el listado', async () => {
    const created: any = await svc.createBreed({ species_id: speciesId, code: 'BRAF-TEST', name: 'Braford Test', purpose: 'beef' });
    expect(created.editable).toBe(true);
    const cat: any = await svc.catalogs();
    const mine = cat.breeds.find((b: any) => b.id === created.id);
    expect(mine.editable).toBe(true);
    expect(mine.name).toBe('Braford Test');
  });

  it('rechaza duplicado (409), aptitud inválida (400) y especie inexistente (400)', async () => {
    await svc.createBreed({ species_id: speciesId, code: 'DUP-TEST', name: 'Dup', purpose: 'dairy' });
    await expect(svc.createBreed({ species_id: speciesId, code: 'DUP-TEST', name: 'Otra', purpose: 'dairy' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.createBreed({ species_id: speciesId, code: 'X', name: 'Y', purpose: 'carne' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createBreed({ species_id: '00000000-0000-0000-0000-000000000000', code: 'X', name: 'Y' })).rejects.toMatchObject({ status: 400 });
  });

  it('borra la raza propia pero NO la del catálogo base', async () => {
    const created: any = await svc.createBreed({ species_id: speciesId, code: 'DEL-TEST', name: 'Borrable' });
    await expect(svc.deleteBreed(created.id)).resolves.toMatchObject({ deleted: true });
    const cat: any = await svc.catalogs();
    expect(cat.breeds.some((b: any) => b.id === created.id)).toBe(false);
    await expect(svc.deleteBreed(globalBreedId)).rejects.toMatchObject({ status: 404 }); // base no editable
  });

  it('extiende diagnósticos por tenant con unicidad y borrado propio', async () => {
    const d: any = await svc.createDiagnosis({ code: 'BRUC', name: 'Brucelosis', category: 'repro', is_notifiable: true });
    expect(d.editable).toBe(true);
    expect(d.is_notifiable).toBe(true);
    await expect(svc.createDiagnosis({ code: 'BRUC', name: 'Otro' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.deleteDiagnosis(d.id)).resolves.toMatchObject({ deleted: true });
    const cat: any = await svc.catalogs();
    expect(cat.diagnoses.some((x: any) => x.id === d.id)).toBe(false);
  });
});
