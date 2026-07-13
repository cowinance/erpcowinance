import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

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

  // ── Helpers ────────────────────────────────────────────────────────────────
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
