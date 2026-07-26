import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { CommerceService } from './commerce.service';
import { SalesService } from './sales.service';

/**
 * Integración de ventas (C-3): totales derivados; entrega → `out` de stock y transición del animal a
 * `sold` que converge en devices (status + status_changed_at + versión LWW + timeline + changeset
 * server-origin). `db.tenant` cae al demo.
 */
describe('commerce — ventas', () => {
  let db: DbService;
  let inv: InventoryService;
  let sales: SalesService;
  let commerce: CommerceService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let itemId: string;
  let whId: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'sales-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    inv = new InventoryService(db);
    const animalStatus = new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    sales = new SalesService(db, inv, animalStatus);
    commerce = new CommerceService(db);

    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Frigorífico Norte', customer_segment: 'slaughterhouse' });
    customerId = cust.id;
    const item: any = await inv.createItem({ name: 'Ternero venta', unit: 'un' });
    itemId = item.id;
    const wh: any = await inv.createWarehouse({ name: 'Depósito ventas' });
    whId = wh.id;
    await inv.recordMovement({ item_id: itemId, warehouse_id: whId, movement_type: 'in', quantity: 100, unit_cost: 10 });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function activeAnimal(): Promise<string> {
    return (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','active','born') RETURNING id`, [tenantId, farmId, speciesId]))[0].id;
  }

  it('crea la venta con totales DERIVADOS y type válido', async () => {
    const s: any = await sales.create({
      customer_partner_id: customerId,
      type: 'product',
      lines: [{ item_id: itemId, quantity: 4, unit_price: 25, tax_rate: 0.21 }],
    });
    expect(s.status).toBe('draft');
    expect(s.subtotal).toBe(100);
    expect(s.tax_total).toBe(21);
    expect(s.total).toBe(121);
    await expect(sales.create({ customer_partner_id: customerId, type: 'no-existe', lines: [{ item_id: itemId, quantity: 1, unit_price: 1 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('validación de cliente: un proveedor puro no puede ser cliente de una venta', async () => {
    const sup: any = await commerce.createPartner({ type: 'supplier', name: 'Solo proveedor', supplier_category: 'feed' });
    await expect(sales.create({ customer_partner_id: sup.id, type: 'product', lines: [{ item_id: itemId, quantity: 1, unit_price: 1 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('entrega de ítem → `out` de stock; idempotente; sin saldo → 403', async () => {
    // El depósito de este test NO es el más viejo del tenant (el demo trae «Galpón Central» antes),
    // pero es el único con saldo de este ítem: la entrega tiene que descontar de acá.
    const before: any[] = await inv.listStock(whId, itemId);
    const q0 = before[0].quantity;
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemId, quantity: 10, unit_price: 25 }] });
    const del: any = await sales.updateStatus(s.id, 'delivered');
    expect(del.status).toBe('delivered');
    expect((await inv.listStock(whId, itemId))[0].quantity).toBe(q0 - 10);
    // Re-entregar es idempotente (mismo estado): no vuelve a descontar.
    await sales.updateStatus(s.id, 'delivered');
    expect((await inv.listStock(whId, itemId))[0].quantity).toBe(q0 - 10);

    // Venta que supera el saldo → 403 y la tx revierte (queda en draft).
    const huge: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemId, quantity: 100000, unit_price: 25 }] });
    await expect(sales.updateStatus(huge.id, 'delivered')).rejects.toMatchObject({ status: 403 });
    expect((await sales.get(huge.id) as any).status).toBe('draft');
  });

  /**
   * De qué depósito sale el stock de una venta (Fase 4).
   *
   * La venta no tiene depósito por línea, así que el sistema lo elige. Elegía el más VIEJO del
   * tenant, y con más de un galpón eso rompía dos veces: una venta perfectamente vendible se
   * rechazaba con 403 «sin saldo» porque las bolsas estaban en el otro galpón, y cuando sí había
   * saldo en el viejo descontaba de ahí aunque la mercadería hubiera salido del otro — el kardex
   * dejaba de coincidir con el piso. Quedó latente mientras el demo no tenía depósitos.
   *
   * Lo que se fija acá es que la elección se hace por SALDO, no por antigüedad.
   */
  describe('de qué depósito sale el stock', () => {
    let itemDos: string;
    let whA: string;
    let whB: string;

    beforeAll(async () => {
      const it2: any = await inv.createItem({ name: 'Sal mineral', unit: 'kg' });
      itemDos = it2.id;
      whA = ((await inv.createWarehouse({ name: 'Galpón A' })) as any).id;
      whB = ((await inv.createWarehouse({ name: 'Galpón B' })) as any).id;
    });

    it('el saldo está en el SEGUNDO galpón: la venta se entrega (antes 403)', async () => {
      // Nada en A, todo en B. Con la selección por antigüedad esta venta no se podía entregar.
      await inv.recordMovement({ item_id: itemDos, warehouse_id: whB, movement_type: 'in', quantity: 40, unit_cost: 5 });

      const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemDos, quantity: 25, unit_price: 8 }] });
      const del: any = await sales.updateStatus(s.id, 'delivered');
      expect(del.status).toBe('delivered');

      expect((await inv.listStock(whB, itemDos))[0].quantity).toBe(15);
      expect(await inv.listStock(whA, itemDos)).toHaveLength(0); // A no se tocó: nunca tuvo nada
      const mov = await db.query<any>(`SELECT warehouse_id FROM stock_movements WHERE reference_type='sale' AND reference_id=$1`, [s.id]);
      expect(mov).toHaveLength(1);
      expect(mov[0].warehouse_id).toBe(whB);
    });

    it('con saldo en los dos, sale del que puede cubrir la venta', async () => {
      // A queda con poco y B con bastante: partir la salida entre depósitos no es algo que la venta
      // haga, así que el único depósito servible es el que cubre la cantidad entera.
      await inv.recordMovement({ item_id: itemDos, warehouse_id: whA, movement_type: 'in', quantity: 6, unit_cost: 5 });
      await inv.recordMovement({ item_id: itemDos, warehouse_id: whB, movement_type: 'in', quantity: 85, unit_cost: 5 }); // B: 15 + 85 = 100

      const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemDos, quantity: 20, unit_price: 8 }] });
      await sales.updateStatus(s.id, 'delivered');

      expect((await inv.listStock(whA, itemDos))[0].quantity).toBe(6); // intacto
      expect((await inv.listStock(whB, itemDos))[0].quantity).toBe(80);
    });

    it('si NINGÚN depósito alcanza → 403 y la venta queda en borrador', async () => {
      // 6 en A y 80 en B: 90 no sale de ninguno. El faltante es real, no un error de elección.
      const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemDos, quantity: 90, unit_price: 8 }] });
      await expect(sales.updateStatus(s.id, 'delivered')).rejects.toMatchObject({ status: 403 });
      expect((await sales.get(s.id) as any).status).toBe('draft');
      expect((await inv.listStock(whA, itemDos))[0].quantity).toBe(6);
      expect((await inv.listStock(whB, itemDos))[0].quantity).toBe(80);
    });
  });

  it('entrega de animal → `sold` convergente: status, versión LWW, timeline y changeset server-origin', async () => {
    const a = await activeAnimal();
    const s: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1500, weight_kg: 420 }] });
    const del: any = await sales.updateStatus(s.id, 'delivered');
    expect(del.status).toBe('delivered');

    const ar = (await db.query<any>(`SELECT status, status_changed_at FROM animals WHERE id=$1`, [a]))[0];
    expect(ar.status).toBe('sold');
    expect(ar.status_changed_at).toBeTruthy();

    const ev = await db.query<any>(`SELECT payload FROM animal_events WHERE animal_id=$1 AND event_type='sale'`, [a]);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.sale_id).toBe(s.id);

    const v = (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [a]))[0];
    expect(v.versions.status).toBeTruthy();

    const cs = await db.query<any>(`SELECT operations FROM sync_changesets WHERE source='server' AND origin_ref=$1`, [`sale:${s.id}`]);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0]).toMatchObject({ kind: 'put', table: 'animals', rowId: a, fields: { status: 'sold' } });
  });

  it('vender un animal ya vendido/no activo → 409; cancelar tras delivered → 409', async () => {
    const a = await activeAnimal();
    const s1: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1500 }] });
    await sales.updateStatus(s1.id, 'delivered');
    // cancelar tras delivered → 409
    await expect(sales.updateStatus(s1.id, 'canceled')).rejects.toMatchObject({ status: 409 });

    // otra venta del mismo animal: al entregar, el animal ya no está activo → 409, y revierte.
    const s2: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: a, quantity: 1, unit_price: 1600 }] });
    await expect(sales.updateStatus(s2.id, 'delivered')).rejects.toMatchObject({ status: 409 });
    expect((await sales.get(s2.id) as any).status).toBe('draft');
  });

  /**
   * Certificaciones de la venta (Fase 3.3). Lo que se fija acá es la EXPANSIÓN POLIMÓRFICA: que una
   * certificación de finca ampare a todos sus animales y una de lote solo a los del lote. Si eso se
   * resolviera mal, el aviso saldría en ventas que están perfectas o —peor— callaría en las que no.
   */
  describe('certificaciones de la venta', () => {
    let loteCert: string;
    let loteSinCert: string;

    const certificar = async (entityType: string, entityId: string, scheme: string, validUntil: string | null, status = 'active') => {
      await db.query(
        `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, valid_from, valid_until, status) VALUES ($1,$2,$3,$4, CURRENT_DATE - 100, $5, $6)`,
        [tenantId, entityType, entityId, scheme, validUntil, status],
      );
    };
    const enLote = async (lot: string) =>
      (await db.query<any>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'M','active','born',$4) RETURNING id`, [tenantId, farmId, speciesId, lot]))[0].id;

    beforeAll(async () => {
      loteCert = (await db.query<any>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote certificado') RETURNING id`, [tenantId, farmId]))[0].id;
      loteSinCert = (await db.query<any>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote común') RETURNING id`, [tenantId, farmId]))[0].id;
      await certificar('farm', farmId, 'Libre de brucelosis', '2030-01-01');
      await certificar('farm', farmId, 'BPG vencida', '2020-01-01');
      await certificar('lot', loteCert, 'Carne Natural', '2030-01-01');
    });

    it('la certificación de FINCA ampara a cualquier animal de la venta', async () => {
      const s: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: await enLote(loteSinCert), quantity: 1, unit_price: 100 }] });
      const r: any = await sales.certifications(s.id);
      expect(r.schemes.find((x: any) => x.scheme === 'Libre de brucelosis').verdict).toBe('ok');
    });

    it('avisa de la vencida ANTES de cerrar, con la venta todavía en borrador', async () => {
      const s: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: await enLote(loteCert), quantity: 1, unit_price: 100 }] });
      expect(s.status).toBe('draft');
      const r: any = await sales.certifications(s.id);
      expect(r.hasWarnings).toBe(true);
      expect(r.schemes.find((x: any) => x.scheme === 'BPG vencida').verdict).toBe('vencida');
    });

    it('LA CERTIFICACIÓN DE LOTE NO SE DERRAMA A LOS ANIMALES DE OTRO LOTE', async () => {
      // Es la prueba que sostiene el aviso: si la cobertura por lote se expandiera mal, una venta
      // mixta se vería como entera y el problema volvería a aparecer en el control.
      const s: any = await sales.create({
        customer_partner_id: customerId,
        type: 'livestock',
        lines: [
          { animal_id: await enLote(loteCert), quantity: 1, unit_price: 100 },
          { animal_id: await enLote(loteSinCert), quantity: 1, unit_price: 100 },
        ],
      });
      const r: any = await sales.certifications(s.id);
      const natural = r.schemes.find((x: any) => x.scheme === 'Carne Natural');
      expect(natural.verdict).toBe('parcial');
      expect(natural.coveredAnimals).toBe(1);
      expect(natural.totalAnimals).toBe(2);
    });

    it('nombra las caravanas: el aviso lo lee quien tiene que ir a buscar los animales', async () => {
      const sinCubrir = await enLote(loteSinCert);
      await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','C-777')`, [tenantId, sinCubrir]);
      const s: any = await sales.create({
        customer_partner_id: customerId,
        type: 'livestock',
        lines: [{ animal_id: await enLote(loteCert), quantity: 1, unit_price: 100 }, { animal_id: sinCubrir, quantity: 1, unit_price: 100 }],
      });
      const r: any = await sales.certifications(s.id);
      expect(r.schemes.find((x: any) => x.scheme === 'Carne Natural').uncoveredTags).toContain('C-777');
    });

    it('una venta SIN animales no avisa de nada', async () => {
      // Vender insumos o leche no tiene animales que certificar: contestar «sin cobertura» sería un
      // aviso sobre algo que no existe.
      const s: any = await sales.create({ customer_partner_id: customerId, type: 'product', lines: [{ item_id: itemId, quantity: 1, unit_price: 10 }] });
      const r: any = await sales.certifications(s.id);
      expect(r.animals).toBe(0);
      expect(r.hasWarnings).toBe(false);
      expect(r.schemes).toEqual([]);
    });

    it('NUNCA bloquea: con la certificación vencida la venta se entrega igual', async () => {
      // El sistema no sabe qué le exige el comprador. Bloquear haría inservible una venta a alguien
      // que no pide nada.
      const s: any = await sales.create({ customer_partner_id: customerId, type: 'livestock', lines: [{ animal_id: await enLote(loteCert), quantity: 1, unit_price: 100 }] });
      expect((await sales.certifications(s.id) as any).hasWarnings).toBe(true);
      const entregada: any = await sales.updateStatus(s.id, 'delivered');
      expect(entregada.status).toBe('delivered');
    });

    it('venta inexistente → 404', async () => {
      await expect(sales.certifications('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
    });
  });
});
