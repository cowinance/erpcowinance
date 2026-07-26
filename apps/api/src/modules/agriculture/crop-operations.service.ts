import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';

const OPERATION_TYPES = ['planting', 'fertilization', 'spraying', 'irrigation', 'harvest', 'tillage'];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * Agricultura — labores + cosechas (AG-2). Una labor con insumo DESCUENTA stock por `consumption`
 * (regla única `InventoryService.recordMovementInTx`) con costo real (avg_cost); una cosecha registra
 * el rinde (yield_per_ha derivado) y opcionalmente SUMA el grano al stock, llevando el cultivo a
 * `harvested`. Todo atómico.
 */
@Injectable()
export class CropOperationsService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
  ) {}

  // ── Labores ────────────────────────────────────────────────────────────────
  async recordOperation(cropId: string, body: any) {
    const t = this.db.tenant;
    await this.requireCrop(cropId);
    const type = body?.operation_type;
    if (!OPERATION_TYPES.includes(type)) throw new BadRequestException({ code: 'agriculture.invalid_operation_type', title: `operation_type inválido (${OPERATION_TYPES.join('|')})` });
    await this.requireOperator(body?.operator_id);
    await this.requireMachinery(body?.machinery_id);
    const performedAt = body?.performed_at ?? new Date().toISOString();
    const itemId = body?.inventory_item_id ?? null;
    const qty = body?.quantity != null ? round3(Number(body.quantity)) : null;

    // Labor sin insumo: registro simple con costo manual opcional.
    if (!itemId) {
      return this.db.one(
        `INSERT INTO crop_operations (tenant_id, crop_id, operation_type, performed_at, machinery_id, operator_id, cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, operation_type, performed_at, inventory_item_id, quantity::float AS quantity, cost::float AS cost`,
        [t, cropId, type, performedAt, body?.machinery_id ?? null, body?.operator_id ?? null, body?.cost ?? null, this.db.user],
      );
    }

    // Labor con insumo: consume stock y deriva el costo real (avg_cost).
    if (!qty || qty <= 0) throw new BadRequestException({ code: 'agriculture.invalid_quantity', title: 'quantity debe ser positiva cuando hay insumo' });
    const warehouseId = body?.warehouse_id;
    if (!warehouseId) throw new BadRequestException({ code: 'agriculture.missing_warehouse', title: 'warehouse_id es obligatorio cuando la labor consume un insumo' });

    return this.db.tx(async (q) => {
      const op = await q.one<{ id: string }>(
        `INSERT INTO crop_operations (tenant_id, crop_id, operation_type, performed_at, inventory_item_id, quantity, machinery_id, operator_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [t, cropId, type, performedAt, itemId, qty, body?.machinery_id ?? null, body?.operator_id ?? null, this.db.user],
      );
      const res: any = await this.inventory.recordMovementInTx(q, {
        item_id: itemId,
        warehouse_id: warehouseId,
        movement_type: 'consumption',
        quantity: -qty,
        reference_type: 'crop_operation',
        reference_id: op!.id,
      });
      const cost = round2(qty * (res?.level?.avg_cost ?? 0));
      await q.query(`UPDATE crop_operations SET cost=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [cost, op!.id, t]);
      return this.getOperationInTx(q, op!.id);
    });
  }

  async listOperations(cropId: string) {
    return this.db.query(
      `SELECT co.id, co.operation_type, co.performed_at, co.inventory_item_id, i.name AS item_name,
              co.quantity::float AS quantity, co.operator_id, e.full_name AS operator_name, co.cost::float AS cost
       FROM crop_operations co LEFT JOIN inventory_items i ON i.id = co.inventory_item_id LEFT JOIN employees e ON e.id = co.operator_id
       WHERE co.crop_id=$1 AND co.tenant_id=$2 AND co.deleted_at IS NULL ORDER BY co.performed_at DESC`,
      [cropId, this.db.tenant],
    );
  }

  // ── Cosechas ───────────────────────────────────────────────────────────────
  async recordHarvest(cropId: string, body: any) {
    const t = this.db.tenant;
    const crop = await this.requireCrop(cropId);
    const yieldQty = round3(Number(body?.yield_quantity));
    if (!Number.isFinite(yieldQty) || yieldQty <= 0) throw new BadRequestException({ code: 'agriculture.invalid_yield', title: 'yield_quantity debe ser positiva' });
    const harvestDate = body?.harvest_date ?? await this.db.today();
    const yieldPerHa = crop.area_ha && crop.area_ha > 0 ? round3(yieldQty / crop.area_ha) : null;
    const destItemId = body?.destination_item_id ?? null;
    const warehouseId = body?.warehouse_id ?? null;
    if (destItemId && !warehouseId) throw new BadRequestException({ code: 'agriculture.missing_warehouse', title: 'warehouse_id es obligatorio para sumar la cosecha al stock' });

    return this.db.tx(async (q) => {
      const harvest = await q.one<{ id: string }>(
        `INSERT INTO harvests (tenant_id, crop_id, harvest_date, yield_quantity, yield_unit, yield_per_ha, moisture_pct, destination_item_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [t, cropId, harvestDate, yieldQty, body?.yield_unit ?? null, yieldPerHa, body?.moisture_pct ?? null, destItemId, this.db.user],
      );
      if (destItemId) {
        // Suma el grano al stock (unit_cost opcional; si es null, no altera el avg_cost).
        await this.inventory.recordMovementInTx(q, {
          item_id: destItemId,
          warehouse_id: warehouseId,
          movement_type: 'in',
          quantity: yieldQty,
          unit_cost: body?.unit_cost ?? null,
          reference_type: 'harvest',
          reference_id: harvest!.id,
        });
      }
      // La cosecha lleva el cultivo a `harvested` (si no era terminal).
      await q.query(`UPDATE crops SET status='harvested', updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status IN ('planned','growing')`, [cropId, t]);
      return this.getHarvestInTx(q, harvest!.id);
    });
  }

  async listHarvests(cropId: string) {
    return this.db.query(
      `SELECT h.id, h.harvest_date, h.yield_quantity::float AS yield_quantity, h.yield_unit, h.yield_per_ha::float AS yield_per_ha,
              h.moisture_pct::float AS moisture_pct, h.destination_item_id, i.name AS destination_item_name
       FROM harvests h LEFT JOIN inventory_items i ON i.id = h.destination_item_id
       WHERE h.crop_id=$1 AND h.tenant_id=$2 AND h.deleted_at IS NULL ORDER BY h.harvest_date DESC`,
      [cropId, this.db.tenant],
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async requireCrop(id: string): Promise<{ id: string; area_ha: number | null }> {
    const c = await this.db.one<{ id: string; area_ha: number | null }>(`SELECT id, area_ha::float AS area_ha FROM crops WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!c) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return c;
  }

  private async requireOperator(id: string | null | undefined) {
    if (!id) return;
    const e = await this.db.one<{ id: string }>(`SELECT id FROM employees WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [id, this.db.tenant]);
    if (!e) throw new NotFoundException({ code: 'agriculture.operator_not_found', title: 'Operario no encontrado o inactivo' });
  }

  private async requireMachinery(id: string | null | undefined) {
    if (!id) return;
    const m = await this.db.one<{ id: string }>(`SELECT id FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!m) throw new NotFoundException({ code: 'agriculture.machinery_not_found', title: 'Maquinaria no encontrada' });
  }

  private async getOperationInTx(q: Q, id: string) {
    return q.one(
      `SELECT id, operation_type, performed_at, inventory_item_id, quantity::float AS quantity, operator_id, cost::float AS cost
       FROM crop_operations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
  }

  private async getHarvestInTx(q: Q, id: string) {
    return q.one(
      `SELECT id, harvest_date, yield_quantity::float AS yield_quantity, yield_unit, yield_per_ha::float AS yield_per_ha, moisture_pct::float AS moisture_pct, destination_item_id
       FROM harvests WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
  }
}
