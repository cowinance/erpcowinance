import { addFarmDays } from '@cowinance/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CryoStorageService } from './cryo-storage.service';
import { NitrogenService } from './nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Nitrógeno del termo (GT-4).
 *
 * Es la etapa que más plata protege: un termo que se seca destruye años de genética, en silencio.
 * Lo que se comprueba acá es que la proyección sea honesta —que no invente cuando no sabe— y que la
 * recarga descuente stock de verdad.
 */
describe('nitrógeno — consumo derivado y recarga contra inventario', () => {
  let db: DbService;
  let cryo: CryoStorageService;
  let nitro: NitrogenService;
  let inv: InventoryService;
  let tmp: string;
  let originalCwd: string;
  let termo: any;
  let item: string;
  let deposito: string;

  // Días RELATIVOS AL DÍA DE LA FINCA, no al de Greenwich.
  //
  // `new Date().toISOString()` da la fecha UTC: a partir de las 21:00 en Buenos Aires ya es mañana
  // allá, así que `dia(0)` era una fecha futura para la finca y la guarda de inventario —que sí
  // compara contra el día de la finca— rechazaba la recarga. El test fallaba tres horas por noche y
  // pasaba el resto del día, que es la peor forma de fallar: parece un test flojo y es el reloj.
  let hoyFinca: string;
  const dia = (n: number) => addFarmDays(hoyFinca, n);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'n2-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    cryo = new CryoStorageService(db);
    inv = new InventoryService(db);
    nitro = new NitrogenService(db, inv);
    hoyFinca = await db.today();
    termo = await cryo.createTank({ code: '207' });

    // Nitrógeno líquido como insumo de inventario. La base demo no trae depósitos ni artículos, así
    // que se crean acá: lo que se prueba es que la recarga consuma stock, no el seed.
    const f = await db.one<any>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [db.tenant]);
    deposito = (await db.one<any>(
      `INSERT INTO warehouses (tenant_id, farm_id, name) VALUES ($1,$2,'Depósito') RETURNING id`,
      [db.tenant, f!.id],
    ))!.id;
    // `unit` es FK al catálogo de unidades: se toma una existente en vez de inventar el código.
    const unidad = await db.one<any>(`SELECT code FROM units LIMIT 1`);
    item = (await db.one<any>(
      `INSERT INTO inventory_items (tenant_id, name, unit) VALUES ($1,'Nitrógeno líquido',$2) RETURNING id`,
      [db.tenant, unidad!.code],
    ))!.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  // Un termo del que no se sabe nada no puede aparecer como si estuviera bien.
  it('sin mediciones el estado es desconocido, no «ok»', async () => {
    const s: any = await nitro.status(termo.id);
    expect(s.state.status).toBe('unknown');
    expect(s.state.reason).toMatch(/ninguna medición/);
  });

  it('con dos mediciones proyecta la fecha de vacío', async () => {
    await nitro.addReading(termo.id, { reading_date: dia(-20), level_cm: 60 });
    await nitro.addReading(termo.id, { reading_date: dia(-10), level_cm: 40 });
    const s: any = await nitro.status(termo.id);
    // 20 cm en 10 días = 2 cm/día; quedan 40 → 20 días desde la última medición.
    expect(s.state.daily_cm).toBe(2);
    expect(s.state.days_remaining).toBe(20);
    expect(s.state.projected_empty_date).toBe(dia(10));
  });

  /**
   * El umbral es sobre los días que quedan y sobre el plazo del PROVEEDOR: lo que decide no es
   * cuánto hay en el termo sino si todavía se llega a pedir y recibir.
   */
  it('el plazo de reposición del proveedor cambia la urgencia sin cambiar el nivel', async () => {
    // Mismos 20 días restantes, tres proveedores distintos.
    await nitro.setLeadDays(termo.id, 5); // se llega de sobra
    expect(((await nitro.status(termo.id)) as any).state.status).toBe('ok');

    await nitro.setLeadDays(termo.id, 15); // hay que pedir ya, pero se llega
    const aviso: any = await nitro.status(termo.id);
    expect(aviso.state.status).toBe('warning');
    expect(aviso.message).toMatch(/Conviene pedir la recarga/);

    await nitro.setLeadDays(termo.id, 25); // pedir hoy YA llega tarde
    const urgente: any = await nitro.status(termo.id);
    expect(urgente.state.status).toBe('critical');
    expect(urgente.message).toMatch(/se pierde todo lo que hay adentro/);
    // El nivel no cambió en ningún momento: lo que cambió es a quién le compramos.
    expect(urgente.state.level_cm).toBe(aviso.state.level_cm);
  });

  // Dos mediciones del mismo día meterían una caída de cero días en el cálculo del consumo.
  it('medir dos veces el mismo día corrige, no acumula', async () => {
    await nitro.addReading(termo.id, { reading_date: dia(-10), level_cm: 35 });
    const s: any = await nitro.status(termo.id);
    expect(s.readings.filter((r: any) => r.reading_date === dia(-10))).toHaveLength(1);
    expect(s.readings.find((r: any) => r.reading_date === dia(-10)).level_cm).toBe(35);
  });

  /**
   * La regla que sostiene GT-4: el consumo solo se puede medir ENTRE recargas. Si las mediciones
   * viejas siguieran contando, la recarga se leería como consumo negativo y la proyección diría
   * cualquier cosa — justo en el dato del que depende no perder la genética.
   */
  it('la recarga corta el ciclo: las mediciones viejas dejan de contar', async () => {
    await nitro.addRefill(termo.id, { refill_date: dia(-5), liters: 30, level_after_cm: 90 });
    const s: any = await nitro.status(termo.id);
    // Con una sola medición desde la recarga (la que dejó la propia recarga), no se puede proyectar.
    expect(s.state.status).toBe('unknown');
    expect(s.state.level_cm).toBe(90);
    expect(s.state.reason).toMatch(/segunda medición/);

    // Y con la siguiente medición vuelve a proyectar, ahora sobre el ciclo nuevo.
    await nitro.addReading(termo.id, { reading_date: dia(-1), level_cm: 82 });
    const s2: any = await nitro.status(termo.id);
    expect(s2.state.daily_cm).toBe(2); // 8 cm en 4 días
    expect(s2.state.days_remaining).toBe(41);
  });

  /**
   * El nitrógeno líquido es un insumo como cualquier otro y su saldo vive en el kardex — mismo
   * criterio que nos llevó a NO poner las pajuelas ahí: cada cosa con su dueño.
   */
  it('la recarga descuenta el stock de nitrógeno', async () => {
    await inv.recordMovement({ item_id: item, warehouse_id: deposito, movement_type: 'in', quantity: 100, occurred_at: dia(-2) });

    const antes = await db.one<any>(
      `SELECT quantity::float AS q FROM stock_levels WHERE item_id=$1 AND warehouse_id=$2 AND tenant_id=$3`,
      [item, deposito, db.tenant],
    );
    const r: any = await nitro.addRefill(termo.id, { refill_date: dia(0), liters: 25, item_id: item, warehouse_id: deposito });
    expect(r.stock_movement_id).toBeTruthy();

    const despues = await db.one<any>(
      `SELECT quantity::float AS q FROM stock_levels WHERE item_id=$1 AND warehouse_id=$2 AND tenant_id=$3`,
      [item, deposito, db.tenant],
    );
    expect(despues.q).toBe(antes.q - 25);
  });

  // Un termo que el sistema cree recargado sin que el stock lo refleje es la clase de desajuste que
  // aparece meses después, cuando ya nadie se acuerda.
  it('si el descuento de stock falla, la recarga no queda registrada', async () => {
    const antes: any = await nitro.status(termo.id);
    await expect(
      nitro.addRefill(termo.id, { refill_date: dia(1), liters: 10, item_id: '00000000-0000-0000-0000-000000000000', warehouse_id: deposito }),
    ).rejects.toBeTruthy();
    const despues: any = await nitro.status(termo.id);
    expect(despues.refills).toHaveLength(antes.refills.length);
  });

  it('rechaza mediciones y recargas mal formadas', async () => {
    await expect(nitro.addReading(termo.id, { level_cm: 30 })).rejects.toMatchObject({ status: 400 });
    await expect(nitro.addReading(termo.id, { reading_date: dia(0), level_cm: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(nitro.addRefill(termo.id, { refill_date: dia(0), liters: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(nitro.setLeadDays(termo.id, 0)).rejects.toMatchObject({ status: 400 });
  });

  it('el listado de todos los termos da el mismo estado que el individual', async () => {
    const todos: any[] = await nitro.statusAll();
    const uno: any = await nitro.status(termo.id);
    const enLista = todos.find((t) => t.tank_id === termo.id);
    expect(enLista.state.days_remaining).toBe(uno.state.days_remaining);
    expect(enLista.state.status).toBe(uno.state.status);
  });
});
