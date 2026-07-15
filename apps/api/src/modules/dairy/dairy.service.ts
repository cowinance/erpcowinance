import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

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
}
