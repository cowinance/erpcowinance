import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { InventoryService } from './inventory.service';

/**
 * El costo unitario NO viaja a quien no tiene `inventario.valuacion`.
 *
 * Es el único permiso del sistema que esconde COLUMNAS y no rutas: el veterinario y el capataz
 * necesitan ver cuántas dosis quedan y cuándo vencen, y esa respuesta traía de paso lo que cuesta
 * cada una. Partir las rutas en dos habría duplicado endpoint, consulta y pantalla para esconder
 * una columna.
 *
 * Se afirma sobre las CLAVES de la respuesta, no sobre valores: lo que importa es que el campo no
 * esté, no que venga en cero. Un `null` significaría «no hay costo cargado», que es un estado real
 * y distinto de «no te lo puedo mostrar».
 */
describe('inventario — la valuación se esconde por rol', () => {
  let db: DbService;
  let inv: InventoryService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let itemId: string;

  const como = <T>(role: string, fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ userId: 'u', tenantId, role }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'valuacion-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    tenantId = db.tenant;

    // Un ítem con costo y un movimiento de entrada: sin datos, «no hay campo de plata» pasaría
    // trivialmente y el test no probaría nada.
    const item: any = await inv.createItem({ name: `Vacuna test ${Date.now()}`, unit: 'un', standard_cost: 1234.5 });
    itemId = item.id;
    const wh = (await inv.listWarehouses())[0] as any;
    await inv.recordMovement({
      item_id: itemId,
      warehouse_id: wh.id,
      movement_type: 'in',
      quantity: 10,
      unit_cost: 1234.5,
    });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('el dueño ve el costo en las tres lecturas', async () => {
    const items: any[] = await como('owner', () => inv.listItems());
    expect(items.find((i) => i.id === itemId)).toHaveProperty('standard_cost');

    const stock: any[] = await como('owner', () => inv.listStock());
    expect(Object.keys(stock[0])).toContain('avg_cost');

    const movs: any[] = await como('owner', () => inv.listMovements());
    expect(Object.keys(movs[0])).toContain('unit_cost');
  }, 60_000);

  it('el veterinario ve las existencias SIN el costo', async () => {
    const items: any[] = await como('veterinarian', () => inv.listItems());
    const mio = items.find((i) => i.id === itemId);
    expect(mio, 'tiene que seguir viendo el ítem').toBeTruthy();
    expect(Object.keys(mio)).not.toContain('standard_cost');
    // Y lo que sí necesita sigue estando: cuántas quedan y cuándo hay que reponer.
    expect(Object.keys(mio)).toEqual(expect.arrayContaining(['name', 'unit', 'reorder_point']));

    const stock: any[] = await como('veterinarian', () => inv.listStock());
    expect(Object.keys(stock[0])).not.toContain('avg_cost');
    expect(Object.keys(stock[0])).toContain('quantity');

    const movs: any[] = await como('veterinarian', () => inv.listMovements());
    expect(Object.keys(movs[0])).not.toContain('unit_cost');
    expect(Object.keys(movs[0])).toContain('quantity');
  }, 60_000);

  it('el capataz tampoco lo ve, aunque escriba inventario', async () => {
    // Escribe existencias (`inventario.existencias: write`) pero no tiene valuación: el permiso de
    // escribir no arrastra el de ver lo que cuesta.
    const items: any[] = await como('foreman', () => inv.listItems());
    expect(Object.keys(items.find((i) => i.id === itemId))).not.toContain('standard_cost');
  }, 60_000);

  it('el contador sí, que es quien valúa', async () => {
    const items: any[] = await como('accountant', () => inv.listItems());
    expect(Object.keys(items.find((i) => i.id === itemId))).toContain('standard_cost');
  }, 60_000);

  /**
   * La rotación contesta DOS preguntas y solo una es de plata. Quien no ve valuación conserva
   * entera la operativa —para cuántos días alcanza, qué hay que reponer— y pierde los importes.
   */
  it('la rotación conserva la cobertura y pierde los importes', async () => {
    const conPlata: any = await como('owner', () => inv.rotation());
    expect(Object.keys(conPlata.totals)).toEqual(
      expect.arrayContaining(['stock_value', 'idle_value', 'items_without_cost']),
    );
    expect(conPlata.items[0]).toHaveProperty('stockValue');

    const sinPlata: any = await como('foreman', () => inv.rotation());
    expect(Object.keys(sinPlata.totals)).not.toContain('stock_value');
    expect(Object.keys(sinPlata.totals)).not.toContain('idle_value');
    expect(Object.keys(sinPlata.totals)).not.toContain('items_without_cost');
    // Los conteos se quedan: son ítems, no importes.
    expect(Object.keys(sinPlata.totals)).toEqual(expect.arrayContaining(['idle_items', 'critical_items']));
    // Y la respuesta operativa queda intacta.
    expect(sinPlata.items[0]).not.toHaveProperty('stockValue');
    expect(Object.keys(sinPlata.items[0])).toEqual(
      expect.arrayContaining(['coverageDays', 'status', 'suggestedReorderPoint']),
    );
  }, 60_000);

  /**
   * Sin contexto de request no se esconde nada: el seed, los jobs y los tests que arman los
   * servicios a mano son código interno de confianza, y filtrarles columnas en silencio haría que
   * un mismo reporte diera distinto según quién lo corra.
   */
  it('sin actor no se filtra nada', async () => {
    const items: any[] = await inv.listItems();
    expect(Object.keys(items.find((i) => i.id === itemId))).toContain('standard_cost');
  }, 60_000);
});
