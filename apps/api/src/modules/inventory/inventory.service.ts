import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addFarmDays, computeStockRotation, DEFAULT_LEAD_TIME_DAYS } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

const CATEGORY_KINDS = ['feed', 'veterinary', 'agrochemical', 'seed', 'fuel', 'spare_part', 'supply', 'product'];

/**
 * Inventario — maestro (INV-1): categorías, ítems y depósitos. Sin movimientos/kardex ni batches
 * (INV-2). Todo por tenant (RLS); baja lógica por `deleted_at` (ítem además `is_active`).
 */
@Injectable()
export class InventoryService {
  constructor(private readonly db: DbService) {}

  /** Catálogo global de unidades (para el dropdown de `unit`). */
  async listUnits() {
    return this.db.query(`SELECT code, name, dimension FROM units ORDER BY dimension, code`);
  }

  private async requireUnit(code: string) {
    const u = await this.db.one<{ code: string }>(`SELECT code FROM units WHERE code = $1`, [code]);
    if (!u) throw new BadRequestException({ code: 'inventory.invalid_unit', title: `Unidad inválida: ${code}` });
  }

  // ── Categorías ────────────────────────────────────────────────────────────
  async listCategories() {
    return this.db.query(
      `SELECT id, name, kind, parent_id FROM inventory_categories WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [this.db.tenant],
    );
  }

  async createCategory(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name es obligatorio' });
    if (!CATEGORY_KINDS.includes(body?.kind)) throw new BadRequestException({ code: 'inventory.invalid_kind', title: `kind inválido (${CATEGORY_KINDS.join('|')})` });
    const t = this.db.tenant;
    if (body?.parent_id) {
      const parent = await this.db.one<{ id: string }>(`SELECT id FROM inventory_categories WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.parent_id, t]);
      if (!parent) throw new NotFoundException({ code: 'inventory.parent_not_found', title: 'Categoría padre no encontrada' });
    }
    return this.db.one(
      `INSERT INTO inventory_categories (tenant_id, name, kind, parent_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, kind, parent_id`,
      [t, name, body.kind, body.parent_id ?? null, this.db.user],
    );
  }

  async updateCategory(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name no puede ser vacío' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body?.kind !== undefined) {
      if (!CATEGORY_KINDS.includes(body.kind)) throw new BadRequestException({ code: 'inventory.invalid_kind', title: 'kind inválido' });
      params.push(body.kind);
      sets.push(`kind = $${params.length}`);
    }
    if (!sets.length) throw new BadRequestException({ code: 'inventory.no_changes', title: 'Nada para actualizar' });
    return this.softUpdate('inventory_categories', id, sets, params, `id, name, kind, parent_id`);
  }

  async deleteCategory(id: string) {
    return this.softDelete('inventory_categories', id);
  }

  // ── Ítems ─────────────────────────────────────────────────────────────────
  async listItems() {
    return this.db.query(
      `SELECT i.id, i.name, i.sku, i.unit, i.track_batches, i.reorder_point::float AS reorder_point, i.standard_cost::float AS standard_cost,
              i.is_active, i.category_id, c.name AS category_name
       FROM inventory_items i LEFT JOIN inventory_categories c ON c.id = i.category_id
       WHERE i.tenant_id = $1 AND i.deleted_at IS NULL ORDER BY i.is_active DESC, i.name`,
      [this.db.tenant],
    );
  }

  async createItem(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name es obligatorio' });
    const unit = String(body?.unit ?? '').trim();
    if (!unit) throw new BadRequestException({ code: 'inventory.missing_unit', title: 'unit es obligatorio' });
    await this.requireUnit(unit);
    const t = this.db.tenant;
    if (body?.category_id) {
      const cat = await this.db.one<{ id: string }>(`SELECT id FROM inventory_categories WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.category_id, t]);
      if (!cat) throw new NotFoundException({ code: 'inventory.category_not_found', title: 'Categoría no encontrada' });
    }
    return this.db.one(
      `INSERT INTO inventory_items (tenant_id, category_id, name, sku, unit, track_batches, reorder_point, standard_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, sku, unit, track_batches, reorder_point::float AS reorder_point, standard_cost::float AS standard_cost, is_active, category_id`,
      [t, body.category_id ?? null, name, body.sku ?? null, unit, body.track_batches === true, body.reorder_point ?? null, body.standard_cost ?? null, this.db.user],
    );
  }

  async updateItem(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name no puede ser vacío' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body?.unit !== undefined) {
      await this.requireUnit(String(body.unit));
      params.push(body.unit);
      sets.push(`unit = $${params.length}`);
    }
    for (const f of ['sku', 'reorder_point', 'standard_cost'] as const) {
      if (body?.[f] !== undefined) {
        params.push(body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (typeof body?.is_active === 'boolean') {
      params.push(body.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (body?.category_id !== undefined) {
      params.push(body.category_id ?? null);
      sets.push(`category_id = $${params.length}`);
    }
    if (!sets.length) throw new BadRequestException({ code: 'inventory.no_changes', title: 'Nada para actualizar' });
    return this.softUpdate('inventory_items', id, sets, params, `id, name, sku, unit, is_active, category_id`);
  }

  async deleteItem(id: string) {
    return this.softDelete('inventory_items', id);
  }

  // ── Depósitos ─────────────────────────────────────────────────────────────
  async listWarehouses() {
    return this.db.query(`SELECT id, name, farm_id FROM warehouses WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`, [this.db.tenant]);
  }

  async createWarehouse(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name es obligatorio' });
    const farm = body?.farm_id ?? (await this.db.defaultFarm());
    if (!farm) throw new BadRequestException({ code: 'inventory.no_farm', title: 'No hay finca para el depósito' });
    return this.db.one(`INSERT INTO warehouses (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, farm_id`, [this.db.tenant, farm, name, this.db.user]);
  }

  async updateWarehouse(id: string, body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'inventory.missing_name', title: 'name es obligatorio' });
    return this.softUpdate('warehouses', id, ['name = $1'], [name], `id, name, farm_id`);
  }

  async deleteWarehouse(id: string) {
    return this.softDelete('warehouses', id);
  }

  // ── Movimientos + existencias (kardex, INV-2a) ──────────────────────────────
  /**
   * Registra un movimiento y actualiza el saldo (`stock_levels`) en la MISMA tx (regla única).
   * `quantity` SIGNADA (+ entra, − sale). avg_cost ponderado solo en entradas con `unit_cost`; no
   * hay stock negativo. Upsert por (item, warehouse, batch) con `IS NOT DISTINCT FROM` (batch NULL).
   */
  async recordMovement(body: any) {
    return this.db.tx((q) => this.recordMovementInTx(q, body));
  }

  /**
   * Punto ÚNICO de mutación de stock: valida, inserta el movimiento y aplica el saldo, todo sobre la
   * tx `q` recibida. Otros módulos (p.ej. recepción de compras, C-2) lo invocan dentro de SU propia
   * tx para mantener la atomicidad y la regla única (applyToLevel). No abre transacción propia.
   */
  async recordMovementInTx(q: Q, body: any) {
    const t = this.db.tenant;
    const TYPES = ['in', 'out', 'adjustment', 'consumption'];
    const itemId = body?.item_id;
    const whId = body?.warehouse_id;
    const type = body?.movement_type;
    const qty = Number(body?.quantity);
    if (!itemId || !whId) throw new BadRequestException({ code: 'inventory.missing_fields', title: 'item_id y warehouse_id son obligatorios' });
    if (!TYPES.includes(type)) throw new BadRequestException({ code: 'inventory.invalid_movement_type', title: `movement_type inválido (${TYPES.join('|')})` });
    if (!Number.isFinite(qty) || qty === 0) throw new BadRequestException({ code: 'inventory.invalid_quantity', title: 'quantity debe ser un número distinto de 0' });
    if (type === 'in' && qty <= 0) throw new BadRequestException({ code: 'inventory.invalid_sign', title: "'in' requiere cantidad positiva" });
    if ((type === 'out' || type === 'consumption') && qty >= 0) throw new BadRequestException({ code: 'inventory.invalid_sign', title: `'${type}' requiere cantidad negativa` });
    const unitCost = body?.unit_cost != null ? Number(body.unit_cost) : null;
    // Un costo negativo se propaga al promedio ponderado y de ahí al valor del inventario, a los
    // costos por centro y al mayor. Medido: 100 kg a 10 más 100 kg a −40 daban un promedio de −15 y
    // un inventario valuado en −3.000 — stock que «vale» menos que nada.
    if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0))
      throw new BadRequestException({
        code: 'inventory.invalid_unit_cost',
        title: 'El costo unitario no puede ser negativo.',
      });

    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    // Un movimiento es un hecho. Con fecha futura entra al saldo de hoy pero se reporta en un
    // período que no llegó: el kardex deja de cuadrar con lo que hay en el galpón.
    const hoy = await this.db.today(q);
    if ((await this.db.farmDateOf(occurredAt, q)) > hoy)
      throw new BadRequestException({
        code: 'inventory.future_date',
        title: 'La fecha del movimiento es futura. Se registra lo que ya ocurrió.',
      });
    const item = await this.requireItem(q, itemId);
    await this.requireWarehouse(q, whId);
    const batchId = await this.resolveBatch(q, item, body?.batch_id);

    const mov = await q.one(
      `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, batch_id, movement_type, quantity, unit_cost, occurred_at, reference_type, reference_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, movement_type, quantity::float AS quantity, occurred_at`,
      [t, itemId, whId, batchId, type, qty, unitCost, occurredAt, body?.reference_type ?? null, body?.reference_id ?? null, this.db.user],
    );
    const level = await this.applyToLevel(q, itemId, whId, batchId, qty, unitCost);
    return { movement: mov, level };
  }

  /**
   * Transferencia entre depósitos (INV-2b): par de movimientos `transfer` (−q origen, +q destino)
   * atómico; el costo VIAJA (el destino pondera con el avg_cost del origen); bloquea si el origen no
   * alcanza. Comparten `reference_id`.
   */
  async recordTransfer(body: any) {
    const t = this.db.tenant;
    const itemId = body?.item_id;
    const fromId = body?.from_warehouse_id;
    const toId = body?.to_warehouse_id;
    const qty = Number(body?.quantity);
    if (!itemId || !fromId || !toId) throw new BadRequestException({ code: 'inventory.missing_fields', title: 'item_id, from_warehouse_id y to_warehouse_id son obligatorios' });
    if (fromId === toId) throw new BadRequestException({ code: 'inventory.same_warehouse', title: 'El origen y el destino deben ser distintos' });
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException({ code: 'inventory.invalid_quantity', title: 'quantity debe ser positiva' });
    const item = await this.requireItem(this.db, itemId);
    await this.requireWarehouse(this.db, fromId);
    await this.requireWarehouse(this.db, toId);
    const batchId = await this.resolveBatch(this.db, item, body?.batch_id);
    const occurredAt = body?.occurred_at ?? new Date().toISOString();

    return this.db.tx(async (q) => {
      const fromLevel = await q.one<{ avg_cost: number | null }>(
        `SELECT avg_cost::float AS avg_cost FROM stock_levels WHERE tenant_id=$1 AND item_id=$2 AND warehouse_id=$3 AND batch_id IS NOT DISTINCT FROM $4`,
        [t, itemId, fromId, batchId],
      );
      const cost = fromLevel?.avg_cost ?? null;
      const ref = randomUUID();
      const insMov = (whId: string, delta: number) =>
        q.query(
          `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, batch_id, movement_type, quantity, unit_cost, occurred_at, reference_type, reference_id, created_by)
           VALUES ($1,$2,$3,$4,'transfer',$5,$6,$7,'transfer',$8,$9)`,
          [t, itemId, whId, batchId, delta, cost, occurredAt, ref, this.db.user],
        );
      await insMov(fromId, -qty);
      const from = await this.applyToLevel(q, itemId, fromId, batchId, -qty, null); // valida no-negativo (rollback si insuficiente)
      await insMov(toId, qty);
      const to = await this.applyToLevel(q, itemId, toId, batchId, qty, cost); // el costo viaja
      return { from: { warehouse_id: fromId, ...from }, to: { warehouse_id: toId, ...to }, quantity: qty };
    });
  }

  // ── Lotes (batches, INV-2b) ─────────────────────────────────────────────────
  async listBatches(itemId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (itemId) {
      params.push(itemId);
      filter = ` AND item_id = $${params.length}`;
    }
    return this.db.query(`SELECT id, item_id, batch_number, expiry_date, supplier_id FROM inventory_batches WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY batch_number`, params);
  }

  async createBatch(body: any) {
    const itemId = body?.item_id;
    const num = String(body?.batch_number ?? '').trim();
    if (!itemId || !num) throw new BadRequestException({ code: 'inventory.missing_fields', title: 'item_id y batch_number son obligatorios' });
    await this.requireItem(this.db, itemId);
    return this.db.one(
      `INSERT INTO inventory_batches (tenant_id, item_id, batch_number, expiry_date, supplier_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, item_id, batch_number, expiry_date, supplier_id`,
      [this.db.tenant, itemId, num, body?.expiry_date ?? null, body?.supplier_id ?? null, this.db.user],
    );
  }

  async deleteBatch(id: string) {
    return this.softDelete('inventory_batches', id);
  }

  /** Existencias por (ítem, depósito): saldo materializado. */
  async listStock(warehouseId?: string, itemId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (warehouseId) {
      params.push(warehouseId);
      filter += ` AND sl.warehouse_id = $${params.length}`;
    }
    if (itemId) {
      params.push(itemId);
      filter += ` AND sl.item_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT sl.item_id, i.name AS item_name, i.unit, sl.warehouse_id, w.name AS warehouse_name, sl.batch_id,
              sl.quantity::float AS quantity, sl.avg_cost::float AS avg_cost
       FROM stock_levels sl JOIN inventory_items i ON i.id = sl.item_id JOIN warehouses w ON w.id = sl.warehouse_id
       WHERE sl.tenant_id = $1 AND sl.deleted_at IS NULL${filter}
       ORDER BY i.name, w.name`,
      params,
    );
  }

  /**
   * Rotación: para cuántos días alcanza cada ítem y qué plata está quieta (Fase 4).
   *
   * El kardex ya decía cuánto hay y cuánto costó. No decía las dos cosas que se preguntan de
   * verdad: **¿para cuántos días me alcanza?** y **¿qué compré que no uso?**
   *
   * El consumo se toma de los movimientos que SALIERON (`out` y `consumption`). Quedan afuera a
   * propósito:
   *
   *   - `in`: una compra sube el stock y no es consumo. Contarla haría parecer que un ítem rota
   *     cuando lo único que pasó fue que se compró.
   *   - `transfer`: mover bolsas de un galpón a otro no gastó nada. Contarlo inflaría el consumo
   *     diario y con él el punto de reposición sugerido — el sistema recomendaría comprar de más.
   *   - `adjustment`: un ajuste corrige un error de carga; no es trabajo hecho.
   *
   * El saldo se suma sobre TODOS los depósitos, igual que la alerta de stock bajo: tener el mínimo
   * repartido en dos galpones no es faltante.
   */
  async rotation(params: { from?: string; to?: string; leadTimeDays?: number } = {}) {
    const to = params.to ?? await this.db.today();
    const from = params.from ?? addFarmDays(to, -180);
    const periodDays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const leadTimeDays = Number(params.leadTimeDays) > 0 ? Number(params.leadTimeDays) : DEFAULT_LEAD_TIME_DAYS;

    const rows = await this.db.query<any>(
      `SELECT i.id, i.name, i.unit, i.reorder_point::float AS reorder_point,
              COALESCE(s.stock, 0)::float AS stock,
              s.avg_cost::float AS avg_cost,
              COALESCE(c.consumed, 0)::float AS consumed,
              mv.days_since_movement
         FROM inventory_items i
         LEFT JOIN LATERAL (
           SELECT sum(sl.quantity) AS stock,
                  -- Promedio PONDERADO por saldo: promediar los costos de dos depósitos con saldos
                  -- muy distintos daría un costo que no existió en ninguna compra.
                  --
                  -- Si CUALQUIER parte del saldo no tiene costo, el costo del ítem es DESCONOCIDO,
                  -- no la parte que sí se sabe. Un COALESCE(avg_cost, 0) acá convertiría «no sé
                  -- cuánto vale» en «no vale nada», y el total de plata quieta saldría más bajo que
                  -- la realidad sin que nada se vea roto.
                  CASE WHEN sum(sl.quantity) > 0 AND count(*) FILTER (WHERE sl.avg_cost IS NULL AND sl.quantity > 0) = 0
                       THEN sum(sl.quantity * sl.avg_cost) / sum(sl.quantity) END AS avg_cost
             FROM stock_levels sl
            WHERE sl.item_id = i.id AND sl.tenant_id = $1 AND sl.deleted_at IS NULL) s ON true
         LEFT JOIN LATERAL (
           SELECT sum(abs(m.quantity)) AS consumed
             FROM stock_movements m
            WHERE m.item_id = i.id AND m.tenant_id = $1 AND m.deleted_at IS NULL
              AND m.movement_type IN ('out','consumption')
              AND m.occurred_at::date BETWEEN $2::date AND $3::date) c ON true
         LEFT JOIN LATERAL (
           SELECT (CURRENT_DATE - max(m.occurred_at)::date)::int AS days_since_movement
             FROM stock_movements m
            WHERE m.item_id = i.id AND m.tenant_id = $1 AND m.deleted_at IS NULL) mv ON true
        WHERE i.tenant_id = $1 AND i.deleted_at IS NULL AND i.is_active
        ORDER BY i.name`,
      [this.db.tenant, from, to],
    );

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      reorder_point: r.reorder_point,
      days_since_movement: r.days_since_movement,
      ...computeStockRotation(
        {
          stock: r.stock,
          consumed: r.consumed,
          periodDays,
          avgCost: r.avg_cost,
          daysSinceMovement: r.days_since_movement,
          reorderPoint: r.reorder_point,
        },
        { leadTimeDays },
      ),
    }));

    // Primero lo que frena el trabajo, después lo que inmoviliza plata, al final lo que anda bien.
    const ORDEN: Record<string, number> = { sin_stock: 0, critico: 1, dormido: 2, normal: 3 };
    items.sort((a, b) => ORDEN[a.status] - ORDEN[b.status] || (b.stockValue ?? 0) - (a.stockValue ?? 0));

    const dormidos = items.filter((i) => i.status === 'dormido');
    return {
      from,
      to,
      period_days: periodDays,
      lead_time_days: leadTimeDays,
      items,
      totals: {
        stock_value: +items.reduce((s, i) => s + (i.stockValue ?? 0), 0).toFixed(2),
        /** Plata quieta: saldo de ítems que no se consumieron en el período. */
        idle_value: +dormidos.reduce((s, i) => s + (i.stockValue ?? 0), 0).toFixed(2),
        idle_items: dormidos.length,
        critical_items: items.filter((i) => i.status === 'critico' || i.status === 'sin_stock').length,
        /** Ítems sin costo cargado: su saldo no entra en los totales de arriba. */
        items_without_cost: items.filter((i) => i.stockValue == null).length,
      },
    };
  }

  /** Kardex: historial de movimientos (más recientes primero). */
  async listMovements(itemId?: string, warehouseId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (itemId) {
      params.push(itemId);
      filter += ` AND m.item_id = $${params.length}`;
    }
    if (warehouseId) {
      params.push(warehouseId);
      filter += ` AND m.warehouse_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT m.id, m.movement_type, m.quantity::float AS quantity, m.unit_cost::float AS unit_cost, m.occurred_at,
              i.name AS item_name, i.unit, w.name AS warehouse_name
       FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id
       WHERE m.tenant_id = $1 AND m.deleted_at IS NULL${filter}
       ORDER BY m.occurred_at DESC, m.created_at DESC LIMIT 100`,
      params,
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Los require* toman un executor `e` (DbService o una tx `q`) para poder validar dentro de una
  // transacción ajena (p.ej. recepción de compras) sin anidar this.db.transaction (deadlock PGlite).
  private async requireItem(e: Q, id: string): Promise<{ id: string; track_batches: boolean }> {
    const item = await e.one<{ id: string; track_batches: boolean }>(`SELECT id, track_batches FROM inventory_items WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!item) throw new NotFoundException({ code: 'inventory.item_not_found', title: 'Ítem no encontrado' });
    return item;
  }

  private async requireWarehouse(e: Q, id: string): Promise<void> {
    const wh = await e.one<{ id: string }>(`SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!wh) throw new NotFoundException({ code: 'inventory.warehouse_not_found', title: 'Depósito no encontrado' });
  }

  /** Resuelve el lote: obligatorio si el ítem controla lotes (y debe pertenecerle); null si no. */
  private async resolveBatch(e: Q, item: { id: string; track_batches: boolean }, batchId?: string | null): Promise<string | null> {
    if (!item.track_batches) return null;
    if (!batchId) throw new BadRequestException({ code: 'inventory.batch_required', title: 'Este ítem controla lotes: batch_id es obligatorio' });
    const b = await e.one<{ id: string }>(`SELECT id FROM inventory_batches WHERE id=$1 AND item_id=$2 AND tenant_id=$3 AND deleted_at IS NULL`, [batchId, item.id, this.db.tenant]);
    if (!b) throw new NotFoundException({ code: 'inventory.batch_not_found', title: 'Lote no encontrado para el ítem' });
    return batchId;
  }

  /** Aplica un delta al saldo (upsert por item/warehouse/batch con IS NOT DISTINCT FROM); recalcula
   *  avg_cost solo al ENTRAR con unit_cost; bloquea si el saldo resultante < 0. Regla única. */
  private async applyToLevel(q: Q, itemId: string, whId: string, batchId: string | null, delta: number, unitCost: number | null): Promise<{ quantity: number; avg_cost: number | null }> {
    const t = this.db.tenant;
    const level = await q.one<{ id: string; quantity: number; avg_cost: number | null }>(
      `SELECT id, quantity::float AS quantity, avg_cost::float AS avg_cost FROM stock_levels
       WHERE tenant_id=$1 AND item_id=$2 AND warehouse_id=$3 AND batch_id IS NOT DISTINCT FROM $4 FOR UPDATE`,
      [t, itemId, whId, batchId],
    );
    const oldQty = level?.quantity ?? 0;
    const newQty = +(oldQty + delta).toFixed(3);
    if (newQty < 0) throw new ForbiddenException({ code: 'inventory.insufficient_stock', title: `Stock insuficiente: hay ${oldQty}, se intenta retirar ${-delta}.` });
    let newAvg = level?.avg_cost ?? null;
    if (delta > 0 && unitCost != null) {
      newAvg = newQty > 0 ? +(((oldQty * (level?.avg_cost ?? unitCost)) + delta * unitCost) / newQty).toFixed(4) : unitCost;
    }
    if (level) await q.query(`UPDATE stock_levels SET quantity=$1, avg_cost=$2, updated_at=now() WHERE id=$3`, [newQty, newAvg, level.id]);
    else await q.query(`INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, batch_id, quantity, avg_cost) VALUES ($1,$2,$3,$4,$5,$6)`, [t, itemId, whId, batchId, newQty, newAvg]);
    return { quantity: newQty, avg_cost: newAvg };
  }

  private async softUpdate(table: string, id: string, sets: string[], params: unknown[], returning: string) {
    params.push(id);
    const idIdx = params.length;
    params.push(this.db.tenant);
    const tIdx = params.length;
    const row = await this.db.one(
      `UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idIdx} AND tenant_id = $${tIdx} AND deleted_at IS NULL RETURNING ${returning}`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'inventory.not_found', title: 'Registro no encontrado' });
    return row;
  }

  private async softDelete(table: string, id: string) {
    const row = await this.db.one<{ id: string }>(
      `UPDATE ${table} SET deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (!row) throw new NotFoundException({ code: 'inventory.not_found', title: 'Registro no encontrado' });
    return { id, deleted: true };
  }
}
