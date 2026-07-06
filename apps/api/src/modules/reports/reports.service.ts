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
       FROM weighings w
       JOIN animals a ON a.id = w.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       WHERE w.tenant_id = $1 AND w.deleted_at IS NULL AND w.weighed_at::date BETWEEN $2::date AND $3::date
       GROUP BY l.name ORDER BY pesajes DESC`,
      [this.db.tenant, from, to],
    );
    const totalWeighings = rows.reduce((s, r) => s + r.pesajes, 0);
    return { from, to, total_pesajes: totalWeighings, rows: rows.map((r) => ({ ...r, gdp_promedio: r.gdp_promedio != null ? Number(r.gdp_promedio) : null })) };
  }

  /** Reproducción del período: eventos del ciclo. */
  async reproduction(fromRaw?: string, toRaw?: string) {
    const to = isoDate(toRaw);
    const from = isoDate(fromRaw ?? new Date(new Date(to).getTime() - 365 * 86400000).toISOString());
    const t = this.db.tenant;
    const [services, diagnoses, calvings, weanings] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE type='service_ai')::int AS ia,
                count(*) FILTER (WHERE type='service_natural')::int AS monta
         FROM breeding_events WHERE tenant_id = $1 AND deleted_at IS NULL AND occurred_at::date BETWEEN $2::date AND $3::date`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM pregnancies
         WHERE tenant_id = $1 AND deleted_at IS NULL AND diagnosis_date BETWEEN $2::date AND $3::date`,
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
    ]);
    return {
      from,
      to,
      servicios: { ia: services?.ia ?? 0, monta: services?.monta ?? 0, total: (services?.ia ?? 0) + (services?.monta ?? 0) },
      diagnosticos: diagnoses?.n ?? 0,
      partos: calvings?.partos ?? 0,
      crias_nacidas: calvings?.crias ?? 0,
      destetes: { n: weanings?.n ?? 0, peso_promedio: weanings?.peso_promedio ?? null },
    };
  }
}
