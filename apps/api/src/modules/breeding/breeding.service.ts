import { Injectable } from '@nestjs/common';
import { computeBreedingKpis } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/** Tipos de evento que cuentan como servicio/entore (excluye celo y sincronización). */
const SERVICE_TYPES = ['service_natural', 'service_ai', 'embryo_transfer'];

/**
 * Cría y recría (C3) — capa de ANÁLISIS sobre el rodeo de cría, sin tablas propias. Compone
 * reproducción (breeding_events, pregnancies), destete (weanings), estructura del rodeo
 * (animals + animal_categories) y superficie (paddocks.area_ha), y deriva las tasas de eficiencia con
 * `computeBreedingKpis`. Complementa el reporte reproductivo de flujo de P9 (no lo duplica): P9 cuenta,
 * C3 deriva las *tasas* (destete/entore, preñez, reposición, kg/ha) y la edad al primer servicio.
 */
@Injectable()
export class BreedingService {
  constructor(private readonly db: DbService) {}

  async summary(fromRaw?: string, toRaw?: string) {
    const to = toRaw ?? new Date().toISOString().slice(0, 10);
    const from = fromRaw ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const placeholders = SERVICE_TYPES.map((_, i) => `$${i + 4}`).join(',');
    const rows = await this.db.query<any>(
      `WITH serviced AS (
         SELECT DISTINCT animal_id FROM breeding_events
         WHERE tenant_id=$1 AND deleted_at IS NULL AND type IN (${placeholders}) AND occurred_at::date BETWEEN $2::date AND $3::date
       ),
       first_service AS (
         SELECT animal_id, MIN(occurred_at) AS first_at FROM breeding_events
         WHERE tenant_id=$1 AND deleted_at IS NULL AND type IN (${placeholders}) GROUP BY animal_id
       )
       SELECT
         (SELECT count(*)::int FROM serviced) AS serviced_females,
         (SELECT count(*)::int FROM pregnancies WHERE tenant_id=$1 AND deleted_at IS NULL AND diagnosis_date BETWEEN $2::date AND $3::date) AS pregnancies,
         (SELECT count(*)::int FROM weanings WHERE tenant_id=$1 AND deleted_at IS NULL AND weaning_date BETWEEN $2::date AND $3::date) AS weanings,
         (SELECT COALESCE(sum(weaning_weight_kg),0)::float FROM weanings WHERE tenant_id=$1 AND deleted_at IS NULL AND weaning_date BETWEEN $2::date AND $3::date) AS weaned_kg,
         (SELECT round(avg(weaning_weight_kg))::int FROM weanings WHERE tenant_id=$1 AND deleted_at IS NULL AND weaning_date BETWEEN $2::date AND $3::date) AS avg_weaning_kg,
         (SELECT count(*)::int FROM animals a JOIN animal_categories c ON c.id=a.category_id WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND c.code='vaca') AS breeding_cows,
         (SELECT count(*)::int FROM animals a JOIN animal_categories c ON c.id=a.category_id WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND c.code='vaquillona') AS replacement_heifers,
         (SELECT COALESCE(sum(area_ha),0)::float FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL) AS total_ha,
         (SELECT round(avg((fs.first_at::date - a.birth_date) / 30.44)::numeric, 1)::float
            FROM first_service fs JOIN animals a ON a.id=fs.animal_id WHERE a.birth_date IS NOT NULL) AS age_first_service_months`,
      [this.db.tenant, from, to, ...SERVICE_TYPES],
    );
    const r = rows[0];
    const kpis = computeBreedingKpis({
      servicedFemales: r.serviced_females,
      pregnancies: r.pregnancies,
      weanings: r.weanings,
      weanedKg: r.weaned_kg,
      breedingCows: r.breeding_cows,
      replacementHeifers: r.replacement_heifers,
      totalHa: r.total_ha,
    });
    return {
      period: { from, to },
      counts: {
        serviced_females: r.serviced_females,
        pregnancies: r.pregnancies,
        weanings: r.weanings,
        avg_weaning_kg: r.avg_weaning_kg,
        breeding_cows: r.breeding_cows,
        replacement_heifers: r.replacement_heifers,
        total_ha: r.total_ha,
        age_first_service_months: r.age_first_service_months,
      },
      pregnancy_rate: kpis.pregnancyRate,
      weaning_rate: kpis.weaningRate,
      replacement_rate: kpis.replacementRate,
      kg_weaned_per_ha: kpis.kgWeanedPerHa,
    };
  }
}
