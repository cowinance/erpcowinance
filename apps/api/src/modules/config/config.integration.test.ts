import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CatalogsService } from './catalogs.service';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Integración de Configuración (A3 · catálogos maestros): lectura de catálogos globales + extensión por
 * tenant de razas/diagnósticos, con validación de dominio, unicidad (409) y protección del catálogo
 * base (no se borran las entradas globales). `db.tenant` cae al demo (que trae razas globales sembradas).
 */
describe('config — catálogos maestros', () => {
  let db: DbService;
  let svc: CatalogsService;
  let flags: FeatureFlagsService;
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
    flags = new FeatureFlagsService(db);
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

  it('cambia la moneda operativa (organización + empresas) a un código del catálogo', async () => {
    const before: any = await svc.currencySettings();
    expect(before.default_currency).toBe('ARS'); // demo argentino
    expect(before.currencies.some((c: any) => c.code === 'USD')).toBe(true);

    const after: any = await svc.setCurrency({ code: 'usd' }); // normaliza a mayúsculas
    expect(after.default_currency).toBe('USD');
    expect(after.companies.every((c: any) => c.functional_currency === 'USD')).toBe(true);

    // Persistió en la organización.
    const [org] = await db.query<{ default_currency: string }>(`SELECT default_currency FROM organizations WHERE id=$1`, [db.tenant]);
    expect(org.default_currency).toBe('USD');
  });

  it('rechaza moneda con formato inválido (400) y código desconocido (400)', async () => {
    await expect(svc.setCurrency({ code: 'US' })).rejects.toMatchObject({ status: 400 }); // formato
    await expect(svc.setCurrency({ code: 'XYZ' })).rejects.toMatchObject({ status: 400 }); // no está en el catálogo
  });

  it('parámetros de organización: lee y actualiza unit_system/locale/timezone', async () => {
    const before: any = await svc.orgSettings();
    expect(before.unit_system).toBe('metric'); // default del demo
    const after: any = await svc.setParams({ unit_system: 'imperial', default_locale: 'en-US', timezone: 'America/Chicago' });
    expect(after.unit_system).toBe('imperial');
    expect(after.default_locale).toBe('en-US');
    await expect(svc.setParams({ unit_system: 'metrico', default_locale: 'es', timezone: 'UTC' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.setParams({ unit_system: 'metric', default_locale: '', timezone: 'UTC' })).rejects.toMatchObject({ status: 400 });
  });

  it('feature flags de módulo: default visible (true), toggle por tenant e isEnabled', async () => {
    const initial: any[] = await flags.list();
    const dairy = initial.find((f) => f.key === 'module_dairy');
    expect(dairy.enabled).toBe(true); // módulos visibles por default (sin fila)
    expect(await flags.isEnabled('module_dairy')).toBe(true);

    // Apagar el módulo (una finca de carne oculta Tambo).
    await flags.set({ key: 'module_dairy', enabled: false });
    expect(await flags.isEnabled('module_dairy')).toBe(false);

    // Upsert idempotente: volver a prender.
    const after: any[] = await flags.set({ key: 'module_dairy', enabled: true });
    expect(after.find((f) => f.key === 'module_dairy').enabled).toBe(true);
    expect(await flags.isEnabled('module_dairy')).toBe(true);

    await expect(flags.set({ key: 'no_existe', enabled: true })).rejects.toMatchObject({ status: 400 });
  });
});
