import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * Entregas de alimento a lote (N-2): entregar `quantity_kg` de una ración a un lote DESCUENTA stock por
 * `consumption` (regla única `InventoryService.recordMovementInTx`) de cada ingrediente según su %, en
 * una tx. El costo es REAL (Σ qty × avg_cost del stock consumido), no el indicativo de la ración.
 * Cierra el «consumo integrado» diferido en Inventario.
 */
@Injectable()
export class FeedDeliveriesService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
  ) {}

  async createDelivery(body: any) {
    const rationId = body?.ration_id;
    const lotId = body?.lot_id;
    const warehouseId = body?.warehouse_id;
    const quantityKg = Number(body?.quantity_kg);
    if (!rationId || !lotId || !warehouseId) throw new BadRequestException({ code: 'nutrition.missing_fields', title: 'ration_id, lot_id y warehouse_id son obligatorios' });
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) throw new BadRequestException({ code: 'nutrition.invalid_quantity', title: 'quantity_kg debe ser positiva' });
    const t = this.db.tenant;

    const lot = await this.db.one<{ id: string }>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [lotId, t]);
    if (!lot) throw new NotFoundException({ code: 'nutrition.lot_not_found', title: 'Lote no encontrado' });
    const wh = await this.db.one<{ id: string }>(`SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [warehouseId, t]);
    if (!wh) throw new NotFoundException({ code: 'nutrition.warehouse_not_found', title: 'Depósito no encontrado' });
    const ration = await this.db.one<{ id: string }>(`SELECT id FROM rations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [rationId, t]);
    if (!ration) throw new NotFoundException({ code: 'nutrition.ration_not_found', title: 'Ración no encontrada' });
    const ingredients = await this.db.query<{ inventory_item_id: string; pct: number }>(
      `SELECT inventory_item_id, pct::float AS pct FROM ration_ingredients WHERE ration_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [rationId, t],
    );
    if (ingredients.length === 0) throw new BadRequestException({ code: 'nutrition.ration_empty', title: 'La ración no tiene ingredientes' });

    // Cabezas: del input o derivadas del lote (foto al momento).
    let animalsCount = body?.animals_count != null ? Number(body.animals_count) : null;
    if (animalsCount == null) {
      const c = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animals WHERE tenant_id=$1 AND current_lot_id=$2 AND status='active' AND deleted_at IS NULL`, [t, lotId]);
      animalsCount = c?.n ?? 0;
    }
    const deliveredAt = body?.delivered_at ?? new Date().toISOString();

    return this.db.tx(async (q) => {
      const delivery = await q.one<{ id: string }>(
        `INSERT INTO feed_deliveries (tenant_id, lot_id, ration_id, delivered_at, quantity_kg, animals_count, total_cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING id`,
        [t, lotId, rationId, deliveredAt, quantityKg, animalsCount, this.db.user],
      );
      let totalCost = 0;
      for (const ing of ingredients) {
        const qty = round3((quantityKg * ing.pct) / 100);
        if (qty <= 0) continue;
        const res: any = await this.inventory.recordMovementInTx(q, {
          item_id: ing.inventory_item_id,
          warehouse_id: warehouseId,
          movement_type: 'consumption',
          quantity: -qty,
          reference_type: 'feed_delivery',
          reference_id: delivery!.id,
        });
        // El consumo no altera el avg_cost: el level devuelto tiene el costo con el que salió el stock.
        totalCost += qty * (res?.level?.avg_cost ?? 0);
      }
      totalCost = round2(totalCost);
      await q.query(`UPDATE feed_deliveries SET total_cost=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [totalCost, delivery!.id, t]);
      return this.getInTx(q, delivery!.id);
    });
  }

  async list(lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (lotId) {
      params.push(lotId);
      filter = ` AND fd.lot_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT fd.id, fd.lot_id, l.name AS lot_name, fd.ration_id, r.name AS ration_name, fd.delivered_at,
              fd.quantity_kg::float AS quantity_kg, fd.animals_count, fd.total_cost::float AS total_cost
       FROM feed_deliveries fd JOIN lots l ON l.id = fd.lot_id LEFT JOIN rations r ON r.id = fd.ration_id
       WHERE fd.tenant_id=$1 AND fd.deleted_at IS NULL${filter} ORDER BY fd.delivered_at DESC, fd.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  private async getInTx(e: Q, id: string) {
    const delivery: any = await e.one(
      `SELECT fd.id, fd.lot_id, l.name AS lot_name, fd.ration_id, r.name AS ration_name, fd.delivered_at,
              fd.quantity_kg::float AS quantity_kg, fd.animals_count, fd.total_cost::float AS total_cost
       FROM feed_deliveries fd JOIN lots l ON l.id = fd.lot_id LEFT JOIN rations r ON r.id = fd.ration_id
       WHERE fd.id=$1 AND fd.tenant_id=$2 AND fd.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!delivery) throw new NotFoundException({ code: 'nutrition.delivery_not_found', title: 'Entrega no encontrada' });
    const costPerHead = delivery.animals_count > 0 ? round2(delivery.total_cost / delivery.animals_count) : null;
    return { ...delivery, cost_per_head: costPerHead };
  }
}
