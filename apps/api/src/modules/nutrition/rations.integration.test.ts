import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { RationsService } from './rations.service';

/**
 * Integración de raciones (N-1): CRUD, Σ% = 100 (regla única), validación de ítems y costo derivado.
 * `db.tenant` cae al demo.
 */
describe('nutrition — raciones', () => {
  let db: DbService;
  let inv: InventoryService;
  let rations: RationsService;
  let originalCwd: string;
  let tmp: string;
  let maiz: string;
  let soja: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'rations-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    rations = new RationsService(db);
    maiz = ((await inv.createItem({ name: 'Maíz', unit: 'kg', standard_cost: 0.3 })) as any).id;
    soja = ((await inv.createItem({ name: 'Soja', unit: 'kg', standard_cost: 0.5 })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea una ración y valida name', async () => {
    const r: any = await rations.createRation({ name: '  Recría 1  ', crude_protein_pct: 16 });
    expect(r.name).toBe('Recría 1');
    expect(r.cost_per_kg).toBe(0);
    await expect(rations.createRation({ name: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('setea ingredientes con Σ% = 100 y deriva cost_per_kg del costo estándar', async () => {
    const r: any = await rations.createRation({ name: 'Engorde' });
    const updated: any = await rations.setIngredients(r.id, { ingredients: [{ inventory_item_id: maiz, pct: 60 }, { inventory_item_id: soja, pct: 40 }] });
    expect(updated.ingredients).toHaveLength(2);
    // 60% × 0.30 + 40% × 0.50 = 0.38
    expect(updated.cost_per_kg).toBe(0.38);
  });

  it('rechaza Σ% ≠ 100 (400) e ítem inexistente/inactivo (404)', async () => {
    const r: any = await rations.createRation({ name: 'Mala' });
    await expect(rations.setIngredients(r.id, { ingredients: [{ inventory_item_id: maiz, pct: 60 }, { inventory_item_id: soja, pct: 30 }] })).rejects.toMatchObject({ status: 400 });
    await expect(rations.setIngredients(r.id, { ingredients: [{ inventory_item_id: '00000000-0000-0000-0000-000000000000', pct: 100 }] })).rejects.toMatchObject({ status: 404 });
  });

  it('reemplaza el set de ingredientes y recomputa el costo', async () => {
    const r: any = await rations.createRation({ name: 'Cambiante' });
    await rations.setIngredients(r.id, { ingredients: [{ inventory_item_id: maiz, pct: 100 }] });
    expect((await rations.get(r.id) as any).cost_per_kg).toBe(0.3);
    const re: any = await rations.setIngredients(r.id, { ingredients: [{ inventory_item_id: soja, pct: 100 }] });
    expect(re.ingredients).toHaveLength(1);
    expect(re.cost_per_kg).toBe(0.5);
  });

  it('categoría objetivo inexistente → 404; archivar', async () => {
    await expect(rations.createRation({ name: 'X', target_category_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    const r: any = await rations.createRation({ name: 'Archivable' });
    await rations.deleteRation(r.id);
    await expect(rations.get(r.id)).rejects.toMatchObject({ status: 404 });
  });
});
