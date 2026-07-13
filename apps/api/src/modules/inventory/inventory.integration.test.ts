import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from './inventory.service';

/**
 * Integración del maestro de inventario (INV-1): CRUD de categorías/ítems/depósitos + validaciones
 * (kind, unit contra el catálogo, name). `db.tenant` cae al tenant demo.
 */
describe('inventory — maestro', () => {
  let db: DbService;
  let inv: InventoryService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'inventory-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('categorías: crea (kind válido), valida, edita y archiva; errores', async () => {
    const cat: any = await inv.createCategory({ name: '  Sanitarios  ', kind: 'veterinary' });
    expect(cat.name).toBe('Sanitarios');
    expect(cat.kind).toBe('veterinary');
    await expect(inv.createCategory({ name: 'x', kind: 'no-existe' })).rejects.toMatchObject({ status: 400 });
    await expect(inv.createCategory({ name: '  ', kind: 'feed' })).rejects.toMatchObject({ status: 400 });

    const list = await inv.listCategories();
    expect(list.find((c: any) => c.id === cat.id)).toBeTruthy();

    const upd: any = await inv.updateCategory(cat.id, { name: 'Veterinaria' });
    expect(upd.name).toBe('Veterinaria');
    await inv.deleteCategory(cat.id);
    expect((await inv.listCategories()).find((c: any) => c.id === cat.id)).toBeFalsy();
    await expect(inv.updateCategory(cat.id, { name: 'z' })).rejects.toMatchObject({ status: 404 });
  });

  it('ítems: unit del catálogo, categoría opcional; valida; edita is_active; archiva', async () => {
    const cat: any = await inv.createCategory({ name: 'Alimentos', kind: 'feed' });
    const item: any = await inv.createItem({ name: 'Maíz', unit: 'kg', category_id: cat.id, reorder_point: 100, standard_cost: 0.3 });
    expect(item.name).toBe('Maíz');
    expect(item.unit).toBe('kg');
    expect(item.is_active).toBe(true);

    await expect(inv.createItem({ name: 'X', unit: 'zzz' })).rejects.toMatchObject({ status: 400 }); // unidad inexistente
    await expect(inv.createItem({ name: '', unit: 'kg' })).rejects.toMatchObject({ status: 400 });

    const listed = (await inv.listItems()).find((i: any) => i.id === item.id)!;
    expect(listed.category_name).toBe('Alimentos');

    const upd: any = await inv.updateItem(item.id, { is_active: false, unit: 'un' });
    expect(upd.is_active).toBe(false);
    expect(upd.unit).toBe('un');
    await inv.deleteItem(item.id);
    expect((await inv.listItems()).find((i: any) => i.id === item.id)).toBeFalsy();
  });

  it('depósitos: crea con finca por defecto, lista y archiva', async () => {
    const wh: any = await inv.createWarehouse({ name: 'Galpón central' });
    expect(wh.name).toBe('Galpón central');
    expect(wh.farm_id).toBeTruthy();
    expect((await inv.listWarehouses()).find((w: any) => w.id === wh.id)).toBeTruthy();
    await inv.deleteWarehouse(wh.id);
    expect((await inv.listWarehouses()).find((w: any) => w.id === wh.id)).toBeFalsy();
  });

  it('units: expone el catálogo global', async () => {
    const units = (await inv.listUnits()).map((u: any) => u.code);
    expect(units).toContain('kg');
    expect(units).toContain('l');
  });
});
