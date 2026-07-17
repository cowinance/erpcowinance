import { Injectable, NotFoundException } from '@nestjs/common';
import { computeFeedlotMetrics } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Engorde a corral (C2 · feedlot) — capa de ANÁLISIS sobre datos existentes, sin tablas propias. Un
 * corral es un lote con `purpose='fattening'`. Compone el consumo de alimento (`feed_deliveries`), el
 * peso y el GDP (`v_weighings`, regla única de P8) y los animales activos del lote (`current_lot_id`),
 * y deriva los indicadores del engorde con `computeFeedlotMetrics` (dominio). Todo por lectura.
 */
@Injectable()
export class FeedlotService {
  constructor(private readonly db: DbService) {}

  /** KPIs agregados de cada corral (lote de engorde). `targetWeight` (opcional) habilita días a terminación. */
  async lots(targetWeight?: number) {
    const rows = await this.db.query<any>(
      `WITH fl AS (
         SELECT l.id, l.name FROM lots l
         WHERE l.tenant_id=$1 AND l.purpose='fattening' AND l.deleted_at IS NULL AND l.is_active
       ),
       ai AS (
         SELECT a.id, a.current_lot_id AS lot_id FROM animals a
         WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND a.current_lot_id IN (SELECT id FROM fl)
       ),
       pa AS (
         SELECT ai.lot_id, ai.id AS animal_id,
           (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=ai.id AND w.tenant_id=$1 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS last_w,
           (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=ai.id AND w.tenant_id=$1 ORDER BY weighed_at ASC, created_at ASC, id ASC LIMIT 1) AS first_w,
           (SELECT adg_since_last FROM v_weighings w WHERE w.animal_id=ai.id AND w.tenant_id=$1 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS last_adg
         FROM ai
       )
       SELECT fl.id, fl.name,
         (SELECT count(*)::int FROM ai WHERE ai.lot_id=fl.id) AS head,
         COALESCE((SELECT sum(quantity_kg) FROM feed_deliveries fd WHERE fd.lot_id=fl.id AND fd.tenant_id=$1 AND fd.deleted_at IS NULL),0)::float AS feed_kg,
         COALESCE((SELECT sum(total_cost) FROM feed_deliveries fd WHERE fd.lot_id=fl.id AND fd.tenant_id=$1 AND fd.deleted_at IS NULL),0)::float AS feed_cost,
         (SELECT avg(last_w)::float FROM pa WHERE pa.lot_id=fl.id) AS avg_weight_kg,
         (SELECT avg(last_adg)::float FROM pa WHERE pa.lot_id=fl.id AND pa.last_adg IS NOT NULL) AS avg_adg,
         COALESCE((SELECT sum(last_w - first_w) FROM pa WHERE pa.lot_id=fl.id AND pa.last_w IS NOT NULL AND pa.first_w IS NOT NULL),0)::float AS kg_gained
       FROM fl ORDER BY fl.name`,
      [this.db.tenant],
    );
    return rows.map((r) => this.withMetrics(r, targetWeight));
  }

  async get(id: string, targetWeight?: number) {
    const rows = await this.lots(targetWeight);
    const lot = rows.find((r) => r.id === id);
    if (!lot) throw new NotFoundException({ code: 'feedlot.lot_not_found', title: 'Corral de engorde no encontrado' });
    const animals = await this.db.query(
      `SELECT a.id, ai.value AS tag,
              (SELECT weight_kg::float FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS weight_kg,
              (SELECT adg_since_last::float FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS adg
       FROM animals a
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id=a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL
       ORDER BY ai.value`,
      [id, this.db.tenant],
    );
    return { ...lot, animals };
  }

  private withMetrics(r: any, targetWeight?: number) {
    const m = computeFeedlotMetrics({
      feedKg: r.feed_kg,
      feedCost: r.feed_cost,
      kgGained: r.kg_gained,
      avgWeightKg: r.avg_weight_kg,
      avgAdg: r.avg_adg,
      targetWeightKg: targetWeight ?? null,
    });
    return { ...r, conversion: m.conversion, cost_per_kg_gained: m.costPerKgGained, days_to_finish: m.daysToFinish };
  }
}
