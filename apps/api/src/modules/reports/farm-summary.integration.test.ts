import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CostingService } from '../costing/costing.service';
import { InventoryService } from '../inventory/inventory.service';
import { buildReportsService } from './reports.test-factory';
import type { ReportsService } from './reports.service';

/**
 * Resumen de la finca (Fase 5).
 *
 * Lo que se fija acá NO es que los números salgan, sino que sean LOS MISMOS que los del módulo
 * dueño de cada uno. Un resumen con su propia consulta se ve idéntico el día que se escribe y se
 * separa en silencio la primera vez que alguien cambia una regla; y como el resumen es la pantalla
 * más mirada, su número equivocado le gana por costumbre al correcto.
 */
describe('reportes — resumen de la finca', () => {
  let db: DbService;
  let reports: ReportsService;
  let costing: CostingService;
  let inventory: InventoryService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'farm-summary-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    reports = buildReportsService(db);
    costing = new CostingService(db);
    inventory = new InventoryService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('EL MARGEN ES EL MISMO QUE EL DE COSTOS, NO UNO PARECIDO', async () => {
    const r: any = await reports.farmSummary();
    const propio: any = await costing.profitability({ level: 'activity', from: r.from, to: r.to });
    expect(r.economia.margen).toBe(propio.totals.margin);
    expect(r.economia.ingresos).toBe(propio.totals.revenue);
    expect(r.economia.costos).toBe(propio.totals.cost);
  });

  it('la plata quieta es la misma que la de Inventario', async () => {
    const r: any = await reports.farmSummary();
    const propio: any = await inventory.rotation({ from: r.from, to: r.to });
    expect(r.inventario.plata_quieta).toBe(propio.totals.idle_value);
    expect(r.inventario.valor).toBe(propio.totals.stock_value);
  });

  it('trae los diez bloques del ERP, no solo hato y sanidad', async () => {
    // El diagnóstico que abrió la fase: Reportes leía tres módulos e ignoraba veinte verticales.
    const r: any = await reports.farmSummary();
    for (const bloque of ['hacienda', 'produccion', 'reproduccion', 'sanidad', 'economia', 'mano_de_obra', 'inventario', 'maquinaria', 'agricultura', 'pastoreo'])
      expect(r).toHaveProperty(bloque);
  });

  it('un módulo sin datos queda en null, NO en cero', async () => {
    // Un cero es una afirmación («gastó 0») y una ausencia es otra cosa. Con ceros, una finca que
    // todavía no usa un módulo leería que ese módulo no le cuesta nada.
    const r: any = await reports.farmSummary({ from: '2040-01-01', to: '2040-12-31' });
    expect(r.agricultura).toBeNull();
    expect(r.pastoreo).toBeNull();
  });

  it('avisa cuando el margen mide la carga de datos y no el ejercicio', async () => {
    // El demo tiene un año de costos y casi ninguna venta: el margen es correcto y engañoso.
    const r: any = await reports.farmSummary();
    expect(r.economia.margen).toBeLessThan(0);
    expect(r.economia.caveat).toMatch(/carga de datos/i);
  });

  it('con ingresos normales NO inventa una advertencia', async () => {
    // Un aviso en cada cierre se aprende a saltear, y entonces tampoco se lee el que importa.
    const [{ id: cliente }] = await db.query<any>(
      `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,(SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1),'customer','Comprador resumen') RETURNING id`,
      [db.tenant],
    );
    await db.query(`INSERT INTO customers (tenant_id, partner_id) VALUES ($1,$2)`, [db.tenant, cliente]);
    const animal = (await db.query<any>(`SELECT id FROM animals WHERE tenant_id=$1 AND status='active' LIMIT 1`, [db.tenant]))[0].id;
    const [{ id: venta }] = await db.query<any>(
      `INSERT INTO sales (tenant_id, company_id, customer_partner_id, sale_date, type, currency, subtotal, tax_total, total, status)
       VALUES ($1,(SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1),$2, CURRENT_DATE - 10,'livestock','USD',400000,0,400000,'delivered') RETURNING id`,
      [db.tenant, cliente],
    );
    await db.query(
      `INSERT INTO sale_lines (tenant_id, sale_id, animal_id, quantity, unit_price, tax_rate, line_total) VALUES ($1,$2,$3,1,400000,0,400000)`,
      [db.tenant, venta, animal],
    );

    const r: any = await reports.farmSummary();
    expect(r.economia.ingresos).toBeGreaterThan(r.economia.costos);
    expect(r.economia.caveat).toBeNull();
  });

  it('un rango inválido se rechaza en vez de devolver un resumen vacío', async () => {
    await expect(reports.farmSummary({ to: 'no-es-fecha' })).rejects.toMatchObject({ status: 400 });
  });
});
