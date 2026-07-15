import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { computeDressingPct, InvalidCarcassError } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Faena (FA-1): `carcass_records` — una res por animal (`animal_id` UNIQUE). El RENDIMIENTO es una
 * regla DERIVADA: `dressing_pct = peso de res ÷ último peso vivo × 100`, cruzando la faena con la
 * última pesada del animal (Producción/GDP). Nunca se acepta del cliente; si el animal no tiene
 * pesadas, queda `null` (no se inventa un número) y la respuesta expone el `live_weight_kg` usado.
 *
 * No toca `animals.status`: el animal ya quedó `sold` al entregarse la venta (AnimalStatusService).
 */
@Injectable()
export class CarcassService {
  constructor(private readonly db: DbService) {}

  async list(saleId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (saleId) {
      params.push(saleId);
      filter = ` AND c.sale_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT c.id, c.animal_id, tag.value AS animal_tag, c.slaughter_date, c.slaughterhouse_id, c.sale_id,
              c.hot_carcass_weight_kg::float AS hot_carcass_weight_kg, c.dressing_pct::float AS dressing_pct,
              c.fat_grade, c.conformation, c.marbling
       FROM carcass_records c
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = c.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
       WHERE c.tenant_id=$1 AND c.deleted_at IS NULL${filter}
       ORDER BY c.slaughter_date DESC, c.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const c = await this.db.one(
      `SELECT id, animal_id, slaughter_date, slaughterhouse_id, sale_id, hot_carcass_weight_kg::float AS hot_carcass_weight_kg,
              dressing_pct::float AS dressing_pct, fat_grade, conformation, marbling
       FROM carcass_records WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!c) throw new NotFoundException({ code: 'slaughter.carcass_not_found', title: 'Registro de faena no encontrado' });
    return c;
  }

  async record(body: any) {
    const t = this.db.tenant;
    const animalId = body?.animal_id;
    const slaughterDate = body?.slaughter_date;
    const carcassKg = Number(body?.hot_carcass_weight_kg);
    if (!animalId || !slaughterDate) throw new BadRequestException({ code: 'slaughter.missing_fields', title: 'animal_id y slaughter_date son obligatorios' });
    if (!Number.isFinite(carcassKg) || carcassKg <= 0) throw new BadRequestException({ code: 'slaughter.invalid_weight', title: 'hot_carcass_weight_kg debe ser positivo' });

    const animal = await this.db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [animalId, t]);
    if (!animal) throw new NotFoundException({ code: 'slaughter.animal_not_found', title: 'Animal no encontrado' });

    // Una res por animal (animal_id es UNIQUE en el esquema): se valida antes para devolver 409, no un 500.
    const dup = await this.db.one<{ id: string }>(`SELECT id FROM carcass_records WHERE animal_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [animalId, t]);
    if (dup) throw new ConflictException({ code: 'slaughter.already_recorded', title: 'Este animal ya tiene una faena registrada' });

    await this.requireSlaughterhouse(body?.slaughterhouse_id);
    await this.requireSaleContainsAnimal(body?.sale_id, animalId);

    // Último peso vivo: la pesada más reciente EN O ANTES del día de faena.
    const weighing = await this.db.one<{ weight_kg: number }>(
      `SELECT weight_kg::float AS weight_kg FROM weighings
       WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL AND weighed_at < ($3::date + INTERVAL '1 day')
       ORDER BY weighed_at DESC LIMIT 1`,
      [t, animalId, slaughterDate],
    );
    const liveKg = weighing?.weight_kg ?? null;

    let dressingPct: number | null;
    try {
      dressingPct = computeDressingPct(carcassKg, liveKg);
    } catch (e) {
      if (e instanceof InvalidCarcassError) throw new BadRequestException({ code: 'slaughter.invalid_carcass', title: e.reason });
      throw e;
    }

    const row = await this.db.one(
      `INSERT INTO carcass_records (tenant_id, animal_id, slaughter_date, slaughterhouse_id, hot_carcass_weight_kg, dressing_pct, fat_grade, conformation, marbling, sale_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, animal_id, slaughter_date, slaughterhouse_id, sale_id, hot_carcass_weight_kg::float AS hot_carcass_weight_kg,
                 dressing_pct::float AS dressing_pct, fat_grade, conformation, marbling`,
      [t, animalId, slaughterDate, body?.slaughterhouse_id ?? null, carcassKg, dressingPct, body?.fat_grade ?? null, body?.conformation ?? null, body?.marbling ?? null, body?.sale_id ?? null, this.db.user],
    );
    // El peso vivo usado se expone para que el rendimiento sea auditable.
    return { ...row, live_weight_kg: liveKg };
  }

  /**
   * Análisis de faena (FA-2): rendimiento promedio + peso de res + n° de reses, agrupado por PADRE
   * (`sire_id`) o por LOTE (`current_lot_id`). El AVG de SQL ignora los rendimientos `null` (reses sin
   * pesada) — no ensucian el promedio, pero la res igual cuenta en `count` y en el peso. Cierra el loop
   * con Genética: evaluar un toro por la res de su progenie.
   */
  async analytics(by: 'sire' | 'lot') {
    const t = this.db.tenant;
    if (by === 'sire') {
      return this.db.query(
        `SELECT a.sire_id AS group_id, st.value AS group_label, count(*)::int AS count,
                ROUND(AVG(c.dressing_pct), 2)::float AS avg_dressing_pct,
                ROUND(AVG(c.hot_carcass_weight_kg), 2)::float AS avg_carcass_kg
         FROM carcass_records c JOIN animals a ON a.id = c.animal_id
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) st ON true
         WHERE c.tenant_id=$1 AND c.deleted_at IS NULL AND a.sire_id IS NOT NULL
         GROUP BY a.sire_id, st.value ORDER BY avg_dressing_pct DESC NULLS LAST`,
        [t],
      );
    }
    return this.db.query(
      `SELECT a.current_lot_id AS group_id, l.name AS group_label, count(*)::int AS count,
              ROUND(AVG(c.dressing_pct), 2)::float AS avg_dressing_pct,
              ROUND(AVG(c.hot_carcass_weight_kg), 2)::float AS avg_carcass_kg
       FROM carcass_records c JOIN animals a ON a.id = c.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       WHERE c.tenant_id=$1 AND c.deleted_at IS NULL AND a.current_lot_id IS NOT NULL
       GROUP BY a.current_lot_id, l.name ORDER BY avg_dressing_pct DESC NULLS LAST`,
      [t],
    );
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE carcass_records SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'slaughter.carcass_not_found', title: 'Registro de faena no encontrado' });
    return { id, deleted: true };
  }

  /** El frigorífico, si se declara, debe ser un CLIENTE del tenant (FK a `customers`). */
  private async requireSlaughterhouse(id: string | null | undefined) {
    if (!id) return;
    const c = await this.db.one<{ id: string }>(`SELECT id FROM customers WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!c) throw new NotFoundException({ code: 'slaughter.slaughterhouse_not_found', title: 'Frigorífico no encontrado (debe ser un cliente)' });
  }

  /** La venta, si se declara, debe ser de hacienda y CONTENER a ese animal en sus líneas. */
  private async requireSaleContainsAnimal(saleId: string | null | undefined, animalId: string) {
    if (!saleId) return;
    const t = this.db.tenant;
    const sale = await this.db.one<{ id: string; type: string }>(`SELECT id, type FROM sales WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [saleId, t]);
    if (!sale) throw new NotFoundException({ code: 'slaughter.sale_not_found', title: 'Venta no encontrada' });
    if (sale.type !== 'livestock') throw new BadRequestException({ code: 'slaughter.sale_not_livestock', title: 'La venta declarada no es de hacienda' });
    const line = await this.db.one<{ id: string }>(`SELECT id FROM sale_lines WHERE sale_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL`, [saleId, animalId, t]);
    if (!line) throw new BadRequestException({ code: 'slaughter.animal_not_in_sale', title: 'La venta declarada no incluye a este animal' });
  }
}
