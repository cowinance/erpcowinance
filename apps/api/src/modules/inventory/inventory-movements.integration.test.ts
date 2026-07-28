import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from './inventory.service';

/**
 * Integración del kardex (INV-2a): un movimiento actualiza el saldo (regla única); avg_cost
 * ponderado en entradas; salidas restan sin cambiar avg; sin stock negativo; validación de signo;
 * ajuste ±. `db.tenant` cae al tenant demo.
 */
describe('inventory — movimientos y existencias', () => {
  let db: DbService;
  let inv: InventoryService;
  let itemId: string;
  let whId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'inv-mov-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    itemId = ((await inv.createItem({ name: 'Maíz kardex', unit: 'kg' })) as any).id;
    whId = ((await inv.createWarehouse({ name: 'Depósito kardex' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('UN COSTO NEGATIVO NO ENTRA: se propaga al promedio y al valor del inventario', async () => {
    // Medido en la auditoría: 100 kg a 10 más 100 kg a −40 daban promedio −15 y un inventario
    // valuado en −3.000. Ese número sigue de largo hasta los costos por centro y el mayor.
    await expect(
      inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 10, unit_cost: -5 }),
    ).rejects.toMatchObject({ response: { code: 'inventory.invalid_unit_cost' } });
  });

  it('UN MOVIMIENTO NO PUEDE SER DEL FUTURO', async () => {
    // Con fecha futura entra al saldo de hoy pero se reporta en un período que no llegó: el kardex
    // deja de cuadrar con lo que hay en el galpón.
    await expect(
      inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 10, occurred_at: '2099-01-01' }),
    ).rejects.toMatchObject({ response: { code: 'inventory.future_date' } });
  });

  it('EL SALDO DE UN ÍTEM SIN LOTE NO SE PUEDE PARTIR EN DOS FILAS', () => {
    // `UNIQUE (item_id, warehouse_id, batch_id)` no alcanza: en PostgreSQL los NULL son distintos
    // entre sí, así que dos filas con el mismo ítem, el mismo depósito y sin lote no la violaban.
    // Bajo concurrencia el saldo quedaba partido en dos filas que nadie suma.
    //
    // No se puede provocar acá —PGlite tiene una sola conexión—, así que se comprueba que el índice
    // parcial que lo impide EXISTA: es lo que hace que el segundo insert falle de forma ruidosa.
    return db
      .query<any>(`SELECT indexdef FROM pg_indexes WHERE tablename='stock_levels' AND indexname='ux_stock_levels_sin_lote'`)
      .then((r) => {
        expect(r, 'falta el índice parcial que impide partir el saldo').toHaveLength(1);
        expect(r[0].indexdef).toContain('batch_id IS NULL');
      });
  });

  it('entrada suma y pondera avg_cost; salida resta sin cambiarlo; sin negativo; ajuste ±', async () => {
    const a = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 2 });
    expect(a.level.quantity).toBe(100);
    expect(a.level.avg_cost).toBe(2);

    const b = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 4 });
    expect(b.level.quantity).toBe(200);
    expect(b.level.avg_cost).toBe(3); // (100*2 + 100*4)/200

    const c = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: -50 });
    expect(c.level.quantity).toBe(150);
    expect(c.level.avg_cost).toBe(3); // salida no cambia el costo

    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: -1000 })).rejects.toMatchObject({ status: 403 }); // insuficiente

    const d = await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'adjustment', quantity: -10 });
    expect(d.level.quantity).toBe(140);
  });

  it('validación de signo por tipo', async () => {
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: -5 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'out', quantity: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'zzz', quantity: 5 })).rejects.toMatchObject({ status: 400 });
  });

  it('existencias y kardex reflejan lo registrado', async () => {
    const stock = (await inv.listStock(whId)).find((s: any) => s.item_id === itemId)!;
    expect(stock.quantity).toBe(140);
    expect(stock.warehouse_name).toBe('Depósito kardex');
    const moves = await inv.listMovements(itemId);
    expect(moves.length).toBeGreaterThanOrEqual(4);
    expect(moves[0].item_name).toBe('Maíz kardex');
  });

  /**
   * Rotación (Fase 4). Lo que se fija acá es QUÉ CUENTA COMO CONSUMO. Si una compra o una
   * transferencia entraran en la cuenta, el consumo diario saldría inflado y con él el punto de
   * reposición sugerido: el sistema recomendaría comprar de más, y el número se vería razonable.
   */
  describe('rotación y cobertura (Fase 4)', () => {
    const R = { from: '2036-01-01', to: '2036-03-31' }; // 91 días
    let corriente: string;
    let dormido: string;
    let otroDeposito: string;

    beforeAll(async () => {
      corriente = ((await inv.createItem({ name: 'Insumo corriente 4', unit: 'kg', standard_cost: 2 })) as any).id;
      dormido = ((await inv.createItem({ name: 'Insumo dormido 4', unit: 'kg' })) as any).id;
      otroDeposito = ((await inv.createWarehouse({ name: 'Depósito 2 · rotación' })) as any).id;

      const mov = (item: string, tipo: string, cantidad: number, fecha: string, wh = whId) =>
        db.query(
          `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, occurred_at) VALUES ($1,$2,$3,$4,$5,2,$6)`,
          [db.tenant, item, wh, tipo, cantidad, `${fecha}T10:00:00Z`],
        );
      const saldo = (item: string, cantidad: number, costo: number | null, wh = whId) =>
        db.query(`INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, quantity, avg_cost) VALUES ($1,$2,$3,$4,$5)`, [db.tenant, item, wh, cantidad, costo]);

      // 910 consumidos en 91 días = 10 por día. Y ruido que NO debe contar.
      await mov(corriente, 'consumption', -910, '2036-02-01');
      await mov(corriente, 'in', 5000, '2036-02-02'); // compra
      await mov(corriente, 'transfer', -400, '2036-02-03'); // mudanza entre galpones
      await mov(corriente, 'adjustment', -300, '2036-02-04'); // corrección de carga
      await mov(corriente, 'consumption', -900, '2035-06-01'); // fuera del período
      await saldo(corriente, 200, 2);
      await saldo(corriente, 100, 2, otroDeposito); // el mínimo repartido en dos galpones no es faltante

      await mov(dormido, 'in', 500, '2035-01-01');
      await saldo(dormido, 500, null); // sin costo cargado
    });

    it('SOLO LO QUE SALIÓ CUENTA COMO CONSUMO', async () => {
      const r: any = await inv.rotation(R);
      const i = r.items.find((x: any) => x.id === corriente);
      expect(i.consumed).toBe(910); // ni la compra, ni la transferencia, ni el ajuste, ni el año pasado
      expect(i.dailyUse).toBe(10);
    });

    it('suma el saldo de TODOS los depósitos', async () => {
      const r: any = await inv.rotation(R);
      const i = r.items.find((x: any) => x.id === corriente);
      expect(i.stock).toBe(300); // 200 + 100
      expect(i.coverageDays).toBe(30);
    });

    it('deriva el mínimo del consumo real, sin depender de que alguien lo cargue', async () => {
      const r: any = await inv.rotation({ ...R, leadTimeDays: 45 });
      expect(r.items.find((x: any) => x.id === corriente).suggestedReorderPoint).toBe(450); // 10/día × 45
    });

    it('el que no se consume es plata quieta, no stock de sobra', async () => {
      const r: any = await inv.rotation(R);
      const i = r.items.find((x: any) => x.id === dormido);
      expect(i.status).toBe('dormido');
      expect(i.coverageDays).toBeNull();
    });

    it('SIN COSTO CARGADO NO VALE CERO: queda fuera de los totales y se dice', async () => {
      // Valorizarlo en cero bajaría el total de plata quieta y nadie lo notaría.
      const r: any = await inv.rotation(R);
      expect(r.items.find((x: any) => x.id === dormido).stockValue).toBeNull();
      expect(r.totals.items_without_cost).toBeGreaterThan(0);
    });

    it('ordena por lo que frena el trabajo, no por saldo', async () => {
      const r: any = await inv.rotation(R);
      const orden = ['sin_stock', 'critico', 'dormido', 'normal'];
      const pos = r.items.map((i: any) => orden.indexOf(i.status));
      for (let k = 1; k < pos.length; k++) expect(pos[k]).toBeGreaterThanOrEqual(pos[k - 1]);
    });
  });
});
