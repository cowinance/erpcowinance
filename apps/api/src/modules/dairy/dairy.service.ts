import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Tambo (TB-1): tanques (`milk_tanks`, maestro) + producción diaria por vaca (`milk_production_daily`).
 * La producción de una vaca en un día es un HECHO ÚNICO (UNIQUE animal+fecha): re-registrarlo CORRIGE
 * (upsert), no da 409 — es lo natural para una carga diaria que se ajusta. Todo por tenant.
 */
@Injectable()
export class DairyService {
  constructor(private readonly db: DbService) {}

  // ── Tanques ────────────────────────────────────────────────────────────────
  async listTanks() {
    return this.db.query(`SELECT id, name, capacity_liters::float AS capacity_liters FROM milk_tanks WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name`, [this.db.tenant]);
  }

  async createTank(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'dairy.missing_name', title: 'name es obligatorio' });
    const farm = body?.farm_id ?? (await this.db.defaultFarm());
    if (!farm) throw new BadRequestException({ code: 'dairy.no_farm', title: 'No hay finca para el tanque' });
    return this.db.one(
      `INSERT INTO milk_tanks (tenant_id, farm_id, name, capacity_liters, created_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, capacity_liters::float AS capacity_liters`,
      [this.db.tenant, farm, name, body?.capacity_liters ?? null, this.db.user],
    );
  }

  async deleteTank(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE milk_tanks SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'dairy.tank_not_found', title: 'Tanque no encontrado' });
    return { id, deleted: true };
  }

  // ── Producción diaria ──────────────────────────────────────────────────────
  async listProduction(productionDate?: string, animalId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (productionDate) {
      params.push(productionDate);
      filter += ` AND m.production_date = $${params.length}`;
    }
    if (animalId) {
      params.push(animalId);
      filter += ` AND m.animal_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT m.id, m.animal_id, tag.value AS animal_tag, m.production_date::text AS production_date,
              m.total_liters::float AS total_liters, m.milking_count
       FROM milk_production_daily m
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = m.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
       WHERE m.tenant_id=$1 AND m.deleted_at IS NULL${filter} ORDER BY m.production_date DESC, tag.value LIMIT 500`,
      params,
    );
  }

  /**
   * Registra la producción de una vaca en un día. UPSERT por (animal, fecha): re-registrar el mismo día
   * actualiza los litros/ordeñes (corrección), no duplica ni da 409.
   */
  async recordProduction(body: any) {
    const t = this.db.tenant;
    const animalId = body?.animal_id;
    const productionDate = body?.production_date;
    const liters = Number(body?.total_liters);
    if (!animalId || !productionDate) throw new BadRequestException({ code: 'dairy.missing_fields', title: 'animal_id y production_date son obligatorios' });
    if (!Number.isFinite(liters) || liters <= 0) throw new BadRequestException({ code: 'dairy.invalid_liters', title: 'total_liters debe ser positivo' });
    const animal = await this.db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [animalId, t]);
    if (!animal) throw new NotFoundException({ code: 'dairy.animal_not_found', title: 'Animal no encontrado' });
    const milkingCount = body?.milking_count != null ? Number(body.milking_count) : null;

    return this.db.one(
      `INSERT INTO milk_production_daily (tenant_id, animal_id, production_date, total_liters, milking_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (animal_id, production_date) DO UPDATE SET total_liters=EXCLUDED.total_liters, milking_count=EXCLUDED.milking_count, updated_at=now(), deleted_at=NULL
       RETURNING id, animal_id, production_date::text AS production_date, total_liters::float AS total_liters, milking_count`,
      [t, animalId, productionDate, liters, milkingCount, this.db.user],
    );
  }

  // ── Entregas (TB-2) ──────────────────────────────────────────────────────
  async listDeliveries() {
    const rows = await this.db.query<any>(
      `SELECT d.id, d.tank_id, tk.name AS tank_name, d.delivered_at, d.liters::float AS liters, d.buyer_id, p.name AS buyer_name, d.price_per_liter::float AS price_per_liter
       FROM milk_deliveries d
       LEFT JOIN milk_tanks tk ON tk.id = d.tank_id
       LEFT JOIN customers c ON c.id = d.buyer_id
       LEFT JOIN business_partners p ON p.id = c.partner_id
       WHERE d.tenant_id=$1 AND d.deleted_at IS NULL ORDER BY d.delivered_at DESC LIMIT 200`,
      [this.db.tenant],
    );
    // `amount` derivado (el esquema no persiste el total): litros × precio/litro.
    return rows.map((r) => ({ ...r, amount: r.price_per_liter != null ? round2(r.liters * r.price_per_liter) : null }));
  }

  async recordDelivery(body: any) {
    const t = this.db.tenant;
    const liters = Number(body?.liters);
    if (!body?.delivered_at || !Number.isFinite(liters) || liters <= 0) throw new BadRequestException({ code: 'dairy.invalid_delivery', title: 'delivered_at y liters (> 0) son obligatorios' });
    if (body?.tank_id) await this.requireTank(body.tank_id);
    if (body?.buyer_id) await this.requireCustomer(body.buyer_id);
    return this.db.one(
      `INSERT INTO milk_deliveries (tenant_id, tank_id, delivered_at, liters, buyer_id, price_per_liter, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tank_id, delivered_at, liters::float AS liters, buyer_id, price_per_liter::float AS price_per_liter`,
      [t, body?.tank_id ?? null, body.delivered_at, liters, body?.buyer_id ?? null, body?.price_per_liter ?? null, this.db.user],
    );
  }

  // ── Calidad (TB-2) ────────────────────────────────────────────────────────
  async listQualityTests() {
    return this.db.query(
      `SELECT q.id, q.animal_id, q.tank_id, tk.name AS tank_name, q.sample_date::text AS sample_date,
              q.fat_pct::float AS fat_pct, q.protein_pct::float AS protein_pct, q.scc
       FROM milk_quality_tests q LEFT JOIN milk_tanks tk ON tk.id = q.tank_id
       WHERE q.tenant_id=$1 AND q.deleted_at IS NULL ORDER BY q.sample_date DESC LIMIT 200`,
      [this.db.tenant],
    );
  }

  async recordQualityTest(body: any) {
    const t = this.db.tenant;
    if (!body?.sample_date) throw new BadRequestException({ code: 'dairy.missing_sample_date', title: 'sample_date es obligatorio' });
    // Referencia EXACTAMENTE una: un animal o un tanque (no ninguno, no ambos).
    const hasAnimal = !!body?.animal_id;
    const hasTank = !!body?.tank_id;
    if (hasAnimal === hasTank) throw new BadRequestException({ code: 'dairy.quality_target', title: 'El test debe referir a un animal O un tanque (exactamente uno)' });
    if (hasAnimal) {
      const a = await this.db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.animal_id, t]);
      if (!a) throw new NotFoundException({ code: 'dairy.animal_not_found', title: 'Animal no encontrado' });
    } else {
      await this.requireTank(body.tank_id);
    }
    return this.db.one(
      `INSERT INTO milk_quality_tests (tenant_id, animal_id, tank_id, sample_date, fat_pct, protein_pct, scc, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, animal_id, tank_id, sample_date::text AS sample_date, fat_pct::float AS fat_pct, protein_pct::float AS protein_pct, scc`,
      [t, body?.animal_id ?? null, body?.tank_id ?? null, body.sample_date, body?.fat_pct ?? null, body?.protein_pct ?? null, body?.scc ?? null, this.db.user],
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async requireTank(id: string) {
    const tk = await this.db.one<{ id: string }>(`SELECT id FROM milk_tanks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!tk) throw new NotFoundException({ code: 'dairy.tank_not_found', title: 'Tanque no encontrado' });
  }

  private async requireCustomer(id: string) {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM customers WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!c) throw new NotFoundException({ code: 'dairy.buyer_not_found', title: 'Comprador no encontrado (debe ser un cliente)' });
  }
}
