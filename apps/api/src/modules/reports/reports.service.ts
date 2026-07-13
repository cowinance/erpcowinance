import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Reportes esenciales (doc APIs §5.12, Roadmap §4.1). El diferencial es el
 * inventario del hato A FECHA reconstruido por el ciclo de vida de cada
 * animal (nacimiento/compra → baja), no por un contador mutable — la promesa
 * de trazabilidad del event store.
 */

const isoDate = (s?: string): string => {
  const d = s ? new Date(s) : new Date();
  if (isNaN(d.getTime())) throw new BadRequestException({ code: 'reports.invalid_date', title: `Fecha inválida: ${s}` });
  return d.toISOString().slice(0, 10);
};

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /**
   * Inventario del hato a una fecha. Un animal está "presente" en la fecha D si
   * ya había ingresado (nacimiento/compra ≤ D) y todavía no había salido
   * (sigue activo, o su baja ocurrió después de D). Reconstrucción pura por
   * fechas del ciclo de vida — el mismo número que daría reproyectar eventos.
   */
  async herdInventory(atRaw?: string, groupBy: 'category' | 'lot' | 'sex' = 'category') {
    const at = isoDate(atRaw);
    const dimension =
      groupBy === 'lot'
        ? { col: 'COALESCE(l.name, $3)', join: 'LEFT JOIN lots l ON l.id = a.current_lot_id', label: 'Lote', fallback: 'Sin lote' }
        : groupBy === 'sex'
          ? { col: `CASE a.sex WHEN 'F' THEN 'Hembras' ELSE 'Machos' END`, join: '', label: 'Sexo', fallback: '' }
          : { col: 'COALESCE(c.name, $3)', join: 'LEFT JOIN animal_categories c ON c.id = a.category_id', label: 'Categoría', fallback: 'Sin categoría' };

    const present = `
      COALESCE(a.birth_date, a.acquisition_date, a.created_at::date) <= $2::date
      AND (a.status = 'active' OR a.status_changed_at IS NULL OR a.status_changed_at::date > $2::date)`;

    const params: unknown[] = [this.db.tenant, at];
    if (groupBy !== 'sex') params.push(dimension.fallback);

    const rows = await this.db.query<any>(
      `SELECT ${dimension.col} AS grupo, count(*)::int AS n
       FROM animals a ${dimension.join}
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND ${present}
       GROUP BY 1 ORDER BY n DESC`,
      params,
    );
    const total = rows.reduce((s, r) => s + r.n, 0);
    return { at, group_by: groupBy, dimension: dimension.label, total, rows };
  }

  /** Altas y bajas del período, reconstruidas por el ciclo de vida. */
  async herdMovements(fromRaw?: string, toRaw?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 365 * 86400000).toISOString());
    const t = this.db.tenant;

    const [births, purchases, exits] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM animals
         WHERE tenant_id = $1 AND origin = 'born' AND deleted_at IS NULL
           AND birth_date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM animals
         WHERE tenant_id = $1 AND origin IN ('purchased','transferred') AND deleted_at IS NULL
           AND COALESCE(acquisition_date, birth_date) BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.query<any>(
        `SELECT status, count(*)::int AS n FROM animals
         WHERE tenant_id = $1 AND status IN ('sold','dead','culled','transferred') AND deleted_at IS NULL
           AND status_changed_at::date BETWEEN $2::date AND $3::date
         GROUP BY status`,
        [t, from, to],
      ),
    ]);

    const exitByStatus: Record<string, number> = {};
    for (const e of exits) exitByStatus[e.status] = e.n;
    const totalIn = (births?.n ?? 0) + (purchases?.n ?? 0);
    const totalOut = exits.reduce((s, e) => s + e.n, 0);

    return {
      from,
      to,
      altas: { nacimientos: births?.n ?? 0, compras: purchases?.n ?? 0, total: totalIn },
      bajas: {
        ventas: exitByStatus['sold'] ?? 0,
        muertes: exitByStatus['dead'] ?? 0,
        descartes: exitByStatus['culled'] ?? 0,
        transferencias: exitByStatus['transferred'] ?? 0,
        total: totalOut,
      },
      variacion_neta: totalIn - totalOut,
    };
  }

  /** Producción del período: pesajes y GDP por lote. */
  async production(fromRaw?: string, toRaw?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 90 * 86400000).toISOString());
    const rows = await this.db.query<any>(
      `SELECT COALESCE(l.name, 'Sin lote') AS lote,
              count(*)::int AS pesajes,
              count(DISTINCT w.animal_id)::int AS animales,
              round(avg(w.weight_kg))::int AS peso_promedio,
              round(avg(w.adg_since_last) FILTER (WHERE w.adg_since_last > 0), 3) AS gdp_promedio
       FROM v_weighings w
       JOIN animals a ON a.id = w.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       WHERE w.tenant_id = $1 AND w.deleted_at IS NULL AND w.weighed_at::date BETWEEN $2::date AND $3::date
       GROUP BY l.name ORDER BY pesajes DESC`,
      [this.db.tenant, from, to],
    );
    const totalWeighings = rows.reduce((s, r) => s + r.pesajes, 0);
    return { from, to, total_pesajes: totalWeighings, rows: rows.map((r) => ({ ...r, gdp_promedio: r.gdp_promedio != null ? Number(r.gdp_promedio) : null })) };
  }

  /**
   * Sanidad del período (P9-2): vacunaciones y tratamientos APLICADOS + mortalidad, acotado a
   * [from, to] (default 90 días). Los snapshots a-fecha (cobertura de vacunación, animales en
   * retiro ahora, vacunas próximas a vencer) NO viven acá: son propiedad de dashboard/alerts.
   * `tasa_pct` de mortalidad = muertes / animales activos a `to` × 100 (aprox); `null` si no hay
   * base. Todo excluye `deleted_at` y acota por fecha.
   */
  async health(fromRaw?: string, toRaw?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 90 * 86400000).toISOString());
    const t = this.db.tenant;
    const [vac, vacByProduct, treat, treatByRoute, mort, activos] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM vaccinations
         WHERE tenant_id = $1 AND deleted_at IS NULL AND applied_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.query<any>(
        `SELECT COALESCE(pv.name, '—') AS producto, count(*)::int AS n
         FROM vaccinations v LEFT JOIN products_veterinary pv ON pv.id = v.product_id
         WHERE v.tenant_id = $1 AND v.deleted_at IS NULL AND v.applied_at::date BETWEEN $2::date AND $3::date
         GROUP BY pv.name ORDER BY n DESC LIMIT 8`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM treatments
         WHERE tenant_id = $1 AND deleted_at IS NULL AND applied_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.query<any>(
        `SELECT COALESCE(route, '—') AS via, count(*)::int AS n FROM treatments
         WHERE tenant_id = $1 AND deleted_at IS NULL AND applied_at::date BETWEEN $2::date AND $3::date
         GROUP BY route ORDER BY n DESC`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n, COALESCE(sum(estimated_loss), 0)::float AS perdida
         FROM mortalities WHERE tenant_id = $1 AND deleted_at IS NULL AND died_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      // Denominador de la tasa de mortalidad: animales activos a la fecha `to` (mismo predicado de
      // "presente a fecha" del inventario).
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM animals a
         WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
           AND COALESCE(a.birth_date, a.acquisition_date, a.created_at::date) <= $2::date
           AND (a.status = 'active' OR a.status_changed_at IS NULL OR a.status_changed_at::date > $2::date)`,
        [t, to],
      ),
    ]);
    const muertes = mort?.n ?? 0;
    const activosN = activos?.n ?? 0;
    return {
      from,
      to,
      vacunaciones: { total: vac?.n ?? 0, por_producto: vacByProduct },
      tratamientos: { total: treat?.n ?? 0, por_via: treatByRoute },
      mortalidad: {
        n: muertes,
        perdida_estimada: mort?.perdida ?? 0,
        base_activos: activosN,
        tasa_pct: activosN > 0 ? +((muertes / activosN) * 100).toFixed(2) : null,
      },
    };
  }

  /**
   * Curva de peso: promedio de peso por mes en el período (default 12 meses), opcionalmente
   * filtrada por lote actual del animal. Lee de `v_weighings` (fuente única P8-1) — incluye los
   * pesajes capturados offline por el móvil.
   */
  async productionWeightSeries(fromRaw?: string, toRaw?: string, lotId?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 365 * 86400000).toISOString());
    const params: unknown[] = [this.db.tenant, from, to];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<{ month: string; avg_kg: number; n: number }>(
      `SELECT to_char(date_trunc('month', w.weighed_at), 'YYYY-MM') AS month,
              round(avg(w.weight_kg))::int AS avg_kg, count(*)::int AS n
       FROM v_weighings w JOIN animals a ON a.id = w.animal_id
       WHERE w.tenant_id = $1 AND w.deleted_at IS NULL
         AND w.weighed_at::date BETWEEN $2::date AND $3::date${lotFilter}
       GROUP BY 1 ORDER BY 1`,
      params,
    );
    return { from, to, lot_id: lotId ?? null, rows };
  }

  /**
   * Distribución de condición corporal: la ÚLTIMA CC por animal ACTIVO a la fecha (default hoy),
   * agrupada en rangos accionables (Flaca <2.5 · Óptima 2.5–3.5 · Gorda >3.5). Reutiliza el
   * predicado de "animal presente a fecha" del inventario. Animales sin CC no cuentan.
   */
  async conditionDistribution(atRaw?: string, lotId?: string) {
    const at = isoDate(atRaw);
    const params: unknown[] = [this.db.tenant, at];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<{ cc: number }>(
      `SELECT latest.body_condition::float AS cc
       FROM (
         SELECT DISTINCT ON (w.animal_id) w.animal_id, w.body_condition
         FROM v_weighings w
         WHERE w.tenant_id = $1 AND w.deleted_at IS NULL
           AND w.body_condition IS NOT NULL AND w.weighed_at::date <= $2::date
         ORDER BY w.animal_id, w.weighed_at DESC, w.created_at DESC, w.id DESC
       ) latest
       JOIN animals a ON a.id = latest.animal_id
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
         AND COALESCE(a.birth_date, a.acquisition_date, a.created_at::date) <= $2::date
         AND (a.status = 'active' OR a.status_changed_at IS NULL OR a.status_changed_at::date > $2::date)${lotFilter}`,
      params,
    );
    const buckets = [
      { label: 'Flaca', min: null as number | null, max: 2.5, n: 0 },
      { label: 'Óptima', min: 2.5, max: 3.5, n: 0 },
      { label: 'Gorda', min: 3.5, max: null as number | null, n: 0 },
    ];
    for (const r of rows) {
      if (r.cc < 2.5) buckets[0].n++;
      else if (r.cc <= 3.5) buckets[1].n++;
      else buckets[2].n++;
    }
    return { at, lot_id: lotId ?? null, total: rows.length, buckets };
  }

  /**
   * Reproducción: conteos del ciclo + ÍNDICES ACOTADOS AL PERÍODO (P9-1). El snapshot operativo
   * «% vientres preñados» NO vive acá: es propiedad de `repro.kpis()` (semántica a-fecha), para no
   * duplicar la regla ni mezclar snapshot con análisis histórico. Todo lo de este bloque es
   * período-scoped [from, to].
   *
   * Fórmulas y semántica de `null` (null = no calculable por falta de denominador/muestra, NUNCA 0):
   * - `prenez_pct` = positivos / (positivos + negativos) × 100. Positivos = diagnósticos + del
   *   período (filas en `pregnancies`); negativos = eventos `animal_events`='pregnancy_negative' del
   *   período. **null** si no hubo diagnósticos (positivos + negativos = 0).
   * - `iep_dias` = promedio de días entre partos consecutivos del MISMO vientre (LAG por `dam_id`),
   *   contando solo intervalos cuyo parto POSTERIOR cae en el período. Un animal con un solo parto
   *   no aporta intervalo. **null** si no hay al menos un intervalo válido.
   * - `servicios_por_prenez` = servicios del período / positivos del período. **null** si no hubo
   *   preñeces (evita división por cero).
   *
   * Todas las consultas excluyen `deleted_at IS NOT NULL` y acotan por fecha, de modo que eventos
   * eliminados, fechas fuera de rango o datos importados sin historial completo quedan fuera.
   */
  async reproduction(fromRaw?: string, toRaw?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 365 * 86400000).toISOString());
    const t = this.db.tenant;
    const [services, diagnoses, negatives, calvings, weanings, iep] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE type='service_ai')::int AS ia,
                count(*) FILTER (WHERE type='service_natural')::int AS monta,
                count(*) FILTER (WHERE type='embryo_transfer')::int AS te
         FROM breeding_events WHERE tenant_id = $1 AND deleted_at IS NULL AND occurred_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM pregnancies
         WHERE tenant_id = $1 AND deleted_at IS NULL AND diagnosis_date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM animal_events
         WHERE tenant_id = $1 AND deleted_at IS NULL AND event_type = 'pregnancy_negative'
           AND occurred_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS partos, COALESCE(sum(offspring_count),0)::int AS crias
         FROM calvings WHERE tenant_id = $1 AND deleted_at IS NULL AND calving_date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n, round(avg(weaning_weight_kg))::int AS peso_promedio
         FROM weanings WHERE tenant_id = $1 AND deleted_at IS NULL AND weaning_date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      // IEP: días promedio entre partos consecutivos por vientre; intervalos cuyo parto POSTERIOR
      // cae en el período (LAG por dam_id, orden por fecha con desempate estable por id).
      this.db.one<any>(
        `SELECT round(avg(gap))::int AS dias FROM (
           SELECT (calving_date - LAG(calving_date) OVER (PARTITION BY dam_id ORDER BY calving_date, id)) AS gap, calving_date
           FROM calvings WHERE tenant_id = $1 AND deleted_at IS NULL
         ) g WHERE g.gap IS NOT NULL AND g.calving_date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
    ]);

    const positivos = diagnoses?.n ?? 0;
    const negativos = negatives?.n ?? 0;
    const totalDiag = positivos + negativos;
    const serviciosTotal = (services?.ia ?? 0) + (services?.monta ?? 0) + (services?.te ?? 0);

    return {
      from,
      to,
      servicios: { ia: services?.ia ?? 0, monta: services?.monta ?? 0, te: services?.te ?? 0, total: serviciosTotal },
      diagnosticos: { positivos, negativos, total: totalDiag },
      partos: calvings?.partos ?? 0,
      crias_nacidas: calvings?.crias ?? 0,
      destetes: { n: weanings?.n ?? 0, peso_promedio: weanings?.peso_promedio ?? null },
      indices: {
        prenez_pct: totalDiag > 0 ? +((positivos / totalDiag) * 100).toFixed(1) : null,
        iep_dias: iep?.dias ?? null,
        servicios_por_prenez: positivos > 0 ? +(serviciosTotal / positivos).toFixed(2) : null,
      },
    };
  }
}
