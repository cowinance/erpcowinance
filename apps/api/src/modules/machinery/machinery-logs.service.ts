import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';

const MAINTENANCE_TYPES = ['preventive', 'corrective', 'inspection'];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * Maquinaria — mantenimiento + combustible (MQ-2). Un carga de combustible con ítem DESCUENTA stock
 * por `consumption` (regla única `InventoryService.recordMovementInTx`) con costo real (avg_cost); el
 * mantenimiento y la carga actualizan las lecturas del maestro (engine_hours / odometer_km).
 */
@Injectable()
export class MachineryLogsService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
  ) {}

  // ── Mantenimiento ───────────────────────────────────────────────────────────
  async recordMaintenance(machineryId: string, body: any) {
    const t = this.db.tenant;
    await this.requireMachinery(machineryId);
    const type = body?.type;
    if (!MAINTENANCE_TYPES.includes(type)) throw new BadRequestException({ code: 'machinery.invalid_maintenance_type', title: `type inválido (${MAINTENANCE_TYPES.join('|')})` });
    const performedAt = body?.performed_at ?? new Date().toISOString();
    const engineHours = body?.engine_hours != null ? Number(body.engine_hours) : null;

    return this.db.tx(async (q) => {
      const rec = await q.one<{ id: string }>(
        `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, description, engine_hours, cost, next_due_date, performed_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [t, machineryId, type, performedAt, body?.description ?? null, engineHours, body?.cost ?? null, body?.next_due_date ?? null, body?.performed_by ?? null, this.db.user],
      );
      if (engineHours != null) await q.query(`UPDATE machinery SET engine_hours=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [engineHours, machineryId, t]);
      return this.getMaintenanceInTx(q, rec!.id);
    });
  }

  async listMaintenance(machineryId: string) {
    return this.db.query(
      `SELECT id, type, performed_at, description, engine_hours::float AS engine_hours, cost::float AS cost, next_due_date, performed_by
       FROM maintenance_records WHERE machinery_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY performed_at DESC`,
      [machineryId, this.db.tenant],
    );
  }

  // ── Combustible ─────────────────────────────────────────────────────────────
  async recordFuel(machineryId: string, body: any) {
    const t = this.db.tenant;
    await this.requireMachinery(machineryId);
    const liters = round3(Number(body?.liters));
    if (!Number.isFinite(liters) || liters <= 0) throw new BadRequestException({ code: 'machinery.invalid_liters', title: 'liters debe ser positiva' });
    await this.requireOperator(body?.operator_id);
    const fueledAt = body?.fueled_at ?? new Date().toISOString();
    const odo = body?.odometer_km != null ? Number(body.odometer_km) : null;
    const hours = body?.engine_hours != null ? Number(body.engine_hours) : null;
    const itemId = body?.item_id ?? null;
    const unitCost = body?.unit_cost != null ? Number(body.unit_cost) : null;

    return this.db.tx(async (q) => {
      const log = await q.one<{ id: string }>(
        `INSERT INTO fuel_logs (tenant_id, machinery_id, fueled_at, item_id, liters, odometer_km, engine_hours, unit_cost, operator_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [t, machineryId, fueledAt, itemId, liters, odo, hours, unitCost, body?.operator_id ?? null, this.db.user],
      );
      let totalCost: number | null;
      if (itemId) {
        // Consume del stock; el costo real sale del avg_cost del combustible.
        const warehouseId = body?.warehouse_id;
        if (!warehouseId) throw new BadRequestException({ code: 'machinery.missing_warehouse', title: 'warehouse_id es obligatorio cuando la carga consume un ítem' });
        const res: any = await this.inventory.recordMovementInTx(q, {
          item_id: itemId,
          warehouse_id: warehouseId,
          movement_type: 'consumption',
          quantity: -liters,
          reference_type: 'fuel_log',
          reference_id: log!.id,
        });
        totalCost = round2(liters * (res?.level?.avg_cost ?? 0));
      } else {
        totalCost = unitCost != null ? round2(liters * unitCost) : null;
      }
      await q.query(`UPDATE fuel_logs SET total_cost=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [totalCost, log!.id, t]);
      // Actualiza las lecturas del maestro.
      if (odo != null || hours != null) {
        await q.query(`UPDATE machinery SET odometer_km=COALESCE($1, odometer_km), engine_hours=COALESCE($2, engine_hours), updated_at=now() WHERE id=$3 AND tenant_id=$4`, [odo, hours, machineryId, t]);
      }
      return this.getFuelInTx(q, log!.id);
    });
  }

  async listFuel(machineryId: string) {
    return this.db.query(
      `SELECT fl.id, fl.fueled_at, fl.item_id, i.name AS item_name, fl.liters::float AS liters, fl.odometer_km::float AS odometer_km,
              fl.unit_cost::float AS unit_cost, fl.total_cost::float AS total_cost, fl.operator_id, e.full_name AS operator_name
       FROM fuel_logs fl LEFT JOIN inventory_items i ON i.id = fl.item_id LEFT JOIN employees e ON e.id = fl.operator_id
       WHERE fl.machinery_id=$1 AND fl.tenant_id=$2 AND fl.deleted_at IS NULL ORDER BY fl.fueled_at DESC`,
      [machineryId, this.db.tenant],
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async requireMachinery(id: string) {
    const m = await this.db.one<{ id: string }>(`SELECT id FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!m) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
  }

  private async requireOperator(id: string | null | undefined) {
    if (!id) return;
    const e = await this.db.one<{ id: string }>(`SELECT id FROM employees WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [id, this.db.tenant]);
    if (!e) throw new NotFoundException({ code: 'machinery.operator_not_found', title: 'Operario no encontrado o inactivo' });
  }

  private async getMaintenanceInTx(q: Q, id: string) {
    return q.one(
      `SELECT id, type, performed_at, description, engine_hours::float AS engine_hours, cost::float AS cost, next_due_date, performed_by
       FROM maintenance_records WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
  }

  private async getFuelInTx(q: Q, id: string) {
    return q.one(
      `SELECT id, fueled_at, item_id, liters::float AS liters, odometer_km::float AS odometer_km, unit_cost::float AS unit_cost, total_cost::float AS total_cost, operator_id
       FROM fuel_logs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
  }
}
