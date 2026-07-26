import { Injectable } from '@nestjs/common';
import { addFarmDays } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Reportes sanitarios (Sanidad E7). Aprovechan los datos estructurados de las etapas previas
 * (diagnósticos, casos clínicos, mortalidad con causa, aplicaciones) para responder: incidencia por
 * diagnóstico, mortalidad por causa/lote/período, animales reincidentes, productos más usados,
 * efectividad (recuperados vs muertos/abiertos) y detección de mortalidad anormal por lote. No duplica
 * el reporte de período de P9 (`reports.service.health`): lo complementa con vistas clínicas nuevas.
 */
@Injectable()
export class HealthReportsService {
  constructor(private readonly db: DbService) {}

  /** Rango por defecto contado desde HOY EN LA FINCA, sobre el calendario (sin husos ni verano). */
  private async range(from?: string, to?: string): Promise<[string, string]> {
    const toD = to ? String(to).slice(0, 10) : await this.db.today();
    const fromD = from ? String(from).slice(0, 10) : addFarmDays(toD, -90);
    return [fromD, toD];
  }

  /** Incidencia por diagnóstico: eventos y animales afectados (casos + eventos clínicos + tratamientos + muertes). */
  async incidence(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    return this.db.query(
      `WITH diag_events AS (
         SELECT diagnosis_id, animal_id FROM clinical_cases WHERE tenant_id = $1 AND deleted_at IS NULL AND diagnosis_id IS NOT NULL AND started_at::date BETWEEN $2 AND $3
         UNION ALL SELECT diagnosis_id, animal_id FROM health_events WHERE tenant_id = $1 AND deleted_at IS NULL AND diagnosis_id IS NOT NULL AND occurred_at::date BETWEEN $2 AND $3
         UNION ALL SELECT diagnosis_id, animal_id FROM treatments WHERE tenant_id = $1 AND deleted_at IS NULL AND diagnosis_id IS NOT NULL AND applied_at::date BETWEEN $2 AND $3
         UNION ALL SELECT cause_diagnosis_id AS diagnosis_id, animal_id FROM mortalities WHERE tenant_id = $1 AND deleted_at IS NULL AND cause_diagnosis_id IS NOT NULL AND died_at::date BETWEEN $2 AND $3
       )
       SELECT d.id AS diagnosis_id, d.name AS diagnosis, d.category, d.is_notifiable,
              count(*)::int AS events, count(DISTINCT de.animal_id)::int AS animals
       FROM diag_events de JOIN diagnoses d ON d.id = de.diagnosis_id
       GROUP BY d.id, d.name, d.category, d.is_notifiable
       ORDER BY events DESC, animals DESC`,
      [this.db.tenant, from, to],
    );
  }

  /** Mortalidad agrupada por causa (diagnóstico), lote o período (mes). */
  async mortality(fromRaw?: string, toRaw?: string, by: 'cause' | 'lot' | 'period' = 'cause') {
    const [from, to] = await this.range(fromRaw, toRaw);
    const t = this.db.tenant;
    if (by === 'lot') {
      return this.db.query(
        `SELECT l.id AS lot_id, COALESCE(l.name, 'Sin lote') AS lot_name, count(*)::int AS deaths,
                round(COALESCE(sum(m.estimated_loss),0)::numeric,2)::float AS estimated_loss
         FROM mortalities m JOIN animals a ON a.id = m.animal_id LEFT JOIN lots l ON l.id = a.current_lot_id
         WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.died_at::date BETWEEN $2 AND $3
         GROUP BY l.id, l.name ORDER BY deaths DESC`, [t, from, to]);
    }
    if (by === 'period') {
      return this.db.query(
        `SELECT to_char(date_trunc('month', died_at), 'YYYY-MM') AS period, count(*)::int AS deaths,
                round(COALESCE(sum(estimated_loss),0)::numeric,2)::float AS estimated_loss
         FROM mortalities WHERE tenant_id = $1 AND deleted_at IS NULL AND died_at::date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 1 DESC`, [t, from, to]);
    }
    return this.db.query(
      `SELECT COALESCE(d.name, 'Sin causa registrada') AS cause, d.category, d.is_notifiable,
              count(*)::int AS deaths, round(COALESCE(sum(m.estimated_loss),0)::numeric,2)::float AS estimated_loss
       FROM mortalities m LEFT JOIN diagnoses d ON d.id = m.cause_diagnosis_id
       WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.died_at::date BETWEEN $2 AND $3
       GROUP BY d.name, d.category, d.is_notifiable ORDER BY deaths DESC`, [t, from, to]);
  }

  /** Animales reincidentes: con ≥ `min` casos clínicos en el período. */
  async recurrent(fromRaw?: string, toRaw?: string, min = 2) {
    const [from, to] = await this.range(fromRaw, toRaw);
    return this.db.query(
      `SELECT a.id AS animal_id, ai.value AS tag, c.name AS category, l.name AS lot_name,
              count(*)::int AS cases,
              count(*) FILTER (WHERE cc.status = ANY('{open,in_treatment,observation}'))::int AS open_cases,
              max(cc.started_at) AS last_case
       FROM clinical_cases cc
       JOIN animals a ON a.id = cc.animal_id
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE cc.tenant_id = $1 AND cc.deleted_at IS NULL AND cc.started_at::date BETWEEN $2 AND $3
       GROUP BY a.id, ai.value, c.name, l.name
       HAVING count(*) >= $4
       ORDER BY cases DESC, last_case DESC LIMIT 100`,
      [this.db.tenant, from, to, min],
    );
  }

  /** Productos veterinarios más usados (tratamientos + vacunaciones) en el período. */
  async products(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    return this.db.query(
      `WITH apps AS (
         SELECT product_id, animal_id, 'treatment' AS kind, COALESCE(cost,0)::float AS cost FROM treatments
           WHERE tenant_id = $1 AND deleted_at IS NULL AND applied_at::date BETWEEN $2 AND $3
         UNION ALL
         SELECT product_id, animal_id, 'vaccination' AS kind, COALESCE(cost,0)::float AS cost FROM vaccinations
           WHERE tenant_id = $1 AND deleted_at IS NULL AND applied_at::date BETWEEN $2 AND $3
       )
       SELECT pv.id AS product_id, pv.name AS product, pv.type,
              count(*)::int AS applications, count(DISTINCT apps.animal_id)::int AS animals,
              round(sum(apps.cost)::numeric,2)::float AS cost
       FROM apps JOIN products_veterinary pv ON pv.id = apps.product_id
       GROUP BY pv.id, pv.name, pv.type ORDER BY applications DESC LIMIT 30`,
      [this.db.tenant, from, to],
    );
  }

  /** Efectividad: desenlace de los casos clínicos iniciados en el período + tasa de recuperación. */
  async effectiveness(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    const row = await this.db.one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = ANY('{open,in_treatment,observation}'))::int AS open,
              count(*) FILTER (WHERE status = 'recovered' OR outcome = 'recovered')::int AS recovered,
              count(*) FILTER (WHERE status = 'died' OR outcome = 'died')::int AS died,
              count(*) FILTER (WHERE status = 'referred' OR outcome = 'referred')::int AS referred,
              count(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM clinical_cases WHERE tenant_id = $1 AND deleted_at IS NULL AND started_at::date BETWEEN $2 AND $3`,
      [this.db.tenant, from, to],
    );
    const recovered = row?.recovered ?? 0;
    const died = row?.died ?? 0;
    const resolved = recovered + died;
    return {
      from, to,
      total: row?.total ?? 0, open: row?.open ?? 0, recovered, died, referred: row?.referred ?? 0, closed: row?.closed ?? 0,
      recovery_rate_pct: resolved > 0 ? +((recovered / resolved) * 100).toFixed(1) : null,
    };
  }

  /**
   * Mortalidad anormal por lote: lotes cuya tasa de mortalidad en la ventana (`days`) supera el
   * umbral. Base = animales presentes en el lote (activos + muertos con ese último lote). Alerta
   * operativa para el panel de control.
   */
  async mortalityAnomaly(days = 90, thresholdPct = 3) {
    const t = this.db.tenant;
    return this.db.query(
      `SELECT l.id AS lot_id, l.name AS lot_name, l.purpose,
              base.head::int AS head, COALESCE(dd.deaths,0)::int AS deaths,
              round((COALESCE(dd.deaths,0)::numeric / NULLIF(base.head,0) * 100), 2)::float AS mortality_pct
       FROM lots l
       JOIN LATERAL (
         SELECT count(*) AS head FROM animals a
         WHERE a.current_lot_id = l.id AND a.tenant_id = $1 AND a.deleted_at IS NULL AND a.status IN ('active','dead')
       ) base ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS deaths FROM mortalities m JOIN animals a2 ON a2.id = m.animal_id
         WHERE a2.current_lot_id = l.id AND m.tenant_id = $1 AND m.deleted_at IS NULL AND m.died_at >= now() - ($2 || ' days')::interval
       ) dd ON true
       WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND base.head > 0
         AND COALESCE(dd.deaths,0) > 0
         AND (COALESCE(dd.deaths,0)::numeric / base.head * 100) >= $3
       ORDER BY mortality_pct DESC`,
      [t, days, thresholdPct],
    );
  }
}
