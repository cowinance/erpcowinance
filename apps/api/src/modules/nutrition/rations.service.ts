import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { validateRationPct, rationCostPerKg, InvalidRationCompositionError, RationIngredientInput } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * Nutrición — raciones (N-1): fórmula (`rations`) + ingredientes (`ration_ingredients`, % de ítems de
 * Inventario). Regla única de la fórmula: los porcentajes suman 100 (validateRationPct). `cost_per_kg`
 * es DERIVADO del costo estándar de los ítems (indicativo); el costo real de una entrega lo pone N-2.
 */
@Injectable()
export class RationsService {
  constructor(private readonly db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT id, name, target_category_id, dry_matter_pct::float AS dry_matter_pct, metabolizable_energy::float AS metabolizable_energy,
              crude_protein_pct::float AS crude_protein_pct, cost_per_kg::float AS cost_per_kg, is_active
       FROM rations WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY is_active DESC, name`,
      [this.db.tenant],
    );
  }

  async get(id: string) {
    const ration = await this.db.one(
      `SELECT id, name, target_category_id, dry_matter_pct::float AS dry_matter_pct, metabolizable_energy::float AS metabolizable_energy,
              crude_protein_pct::float AS crude_protein_pct, cost_per_kg::float AS cost_per_kg, is_active
       FROM rations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!ration) throw new NotFoundException({ code: 'nutrition.ration_not_found', title: 'Ración no encontrada' });
    const ingredients = await this.db.query(
      `SELECT ri.id, ri.inventory_item_id, ri.pct::float AS pct, i.name AS item_name, i.unit, i.standard_cost::float AS standard_cost
       FROM ration_ingredients ri JOIN inventory_items i ON i.id = ri.inventory_item_id
       WHERE ri.ration_id=$1 AND ri.tenant_id=$2 AND ri.deleted_at IS NULL ORDER BY ri.pct DESC`,
      [id, this.db.tenant],
    );
    return { ...ration, ingredients };
  }

  async createRation(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'nutrition.missing_name', title: 'name es obligatorio' });
    await this.requireCategory(body?.target_category_id);
    return this.db.one(
      `INSERT INTO rations (tenant_id, name, target_category_id, dry_matter_pct, metabolizable_energy, crude_protein_pct, cost_per_kg, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7)
       RETURNING id, name, target_category_id, dry_matter_pct::float AS dry_matter_pct, metabolizable_energy::float AS metabolizable_energy, crude_protein_pct::float AS crude_protein_pct, cost_per_kg::float AS cost_per_kg, is_active`,
      [this.db.tenant, name, body?.target_category_id ?? null, body?.dry_matter_pct ?? null, body?.metabolizable_energy ?? null, body?.crude_protein_pct ?? null, this.db.user],
    );
  }

  async updateRation(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) throw new BadRequestException({ code: 'nutrition.missing_name', title: 'name no puede ser vacío' });
      set('name', name);
    }
    if (body?.target_category_id !== undefined) {
      await this.requireCategory(body.target_category_id);
      set('target_category_id', body.target_category_id ?? null);
    }
    for (const f of ['dry_matter_pct', 'metabolizable_energy', 'crude_protein_pct'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (typeof body?.is_active === 'boolean') set('is_active', body.is_active);
    if (!sets.length) throw new BadRequestException({ code: 'nutrition.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE rations SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, name, target_category_id, is_active`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'nutrition.ration_not_found', title: 'Ración no encontrada' });
    return row;
  }

  async deleteRation(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE rations SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'nutrition.ration_not_found', title: 'Ración no encontrada' });
    return { id, deleted: true };
  }

  /**
   * Reemplaza el set de ingredientes de una ración (Σ% = 100, regla única del dominio) y recalcula el
   * `cost_per_kg` indicativo desde el costo estándar de los ítems, todo en una tx.
   */
  async setIngredients(rationId: string, body: any) {
    const t = this.db.tenant;
    await this.requireRation(rationId);
    const raw = Array.isArray(body?.ingredients) ? body.ingredients : [];
    // Valida ítems y arma la entrada del dominio con su costo estándar.
    const ingredients: RationIngredientInput[] = [];
    for (const r of raw) {
      const itemId = r?.inventory_item_id;
      const pct = Number(r?.pct);
      if (!itemId) throw new BadRequestException({ code: 'nutrition.missing_item', title: 'Cada ingrediente necesita inventory_item_id' });
      const item = await this.db.one<{ id: string; standard_cost: number | null }>(`SELECT id, standard_cost::float AS standard_cost FROM inventory_items WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [itemId, t]);
      if (!item) throw new NotFoundException({ code: 'nutrition.item_not_found', title: `Ítem de inventario no encontrado o inactivo: ${itemId}` });
      ingredients.push({ inventory_item_id: itemId, pct, standard_cost: item.standard_cost });
    }
    try {
      validateRationPct(ingredients);
    } catch (e) {
      if (e instanceof InvalidRationCompositionError) throw new BadRequestException({ code: 'nutrition.invalid_composition', title: e.reason });
      throw e;
    }
    const costPerKg = rationCostPerKg(ingredients);

    return this.db.tx(async (q) => {
      await q.query(`UPDATE ration_ingredients SET deleted_at=now() WHERE ration_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [rationId, t]);
      for (const ing of ingredients) {
        await q.query(`INSERT INTO ration_ingredients (tenant_id, ration_id, inventory_item_id, pct, created_by) VALUES ($1,$2,$3,$4,$5)`, [t, rationId, ing.inventory_item_id, ing.pct, this.db.user]);
      }
      await q.query(`UPDATE rations SET cost_per_kg=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [costPerKg, rationId, t]);
      return this.getInTx(q, rationId);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async requireRation(id: string) {
    const r = await this.db.one<{ id: string }>(`SELECT id FROM rations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!r) throw new NotFoundException({ code: 'nutrition.ration_not_found', title: 'Ración no encontrada' });
  }

  private async requireCategory(id: string | null | undefined) {
    if (!id) return;
    const c = await this.db.one<{ id: string }>(`SELECT id FROM animal_categories WHERE id=$1`, [id]); // catálogo global
    if (!c) throw new NotFoundException({ code: 'nutrition.category_not_found', title: 'Categoría objetivo no encontrada' });
  }

  private async getInTx(e: Q, id: string) {
    const ration = await e.one(
      `SELECT id, name, target_category_id, cost_per_kg::float AS cost_per_kg, is_active FROM rations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    const ingredients = await e.query(
      `SELECT ri.id, ri.inventory_item_id, ri.pct::float AS pct, i.name AS item_name, i.unit FROM ration_ingredients ri JOIN inventory_items i ON i.id = ri.inventory_item_id
       WHERE ri.ration_id=$1 AND ri.tenant_id=$2 AND ri.deleted_at IS NULL ORDER BY ri.pct DESC`,
      [id, this.db.tenant],
    );
    return { ...ration, ingredients };
  }
}
