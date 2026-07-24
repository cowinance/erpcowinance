import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Costos por CENTRO (G2 · Costos y rentabilidad, E1) — contabilidad de gestión.
 *
 * Capa de ANÁLISIS: no crea tablas ni registra costos nuevos. Los costos reales YA existen en las
 * tablas de hecho de cada módulo (sanidad, nutrición, agricultura, maquinaria) porque cada
 * operación los calculó al ocurrir —con el costo promedio real del inventario, no estimado—. Acá se
 * los acumula y atribuye a un centro (lote / animal / cultivo / máquina).
 *
 * REGLA ÚNICA ANTI-DOBLE-CONTEO: se suma el HECHO OPERATIVO, nunca el movimiento de stock que lo
 * respalda. `treatments.cost`, `feed_deliveries.total_cost` y `crop_operations.cost` ya SON el
 * consumo de inventario valorizado (los servicios de sanidad/nutrición/agricultura descuentan stock
 * y sellan el costo en el hecho). Sumar además `stock_movements` contaría todo dos veces.
 *
 * Por qué NO se lee del libro mayor: el catálogo describe G2 sobre `journal_lines` + `cost_centers`,
 * y `LedgerService` ya acepta `cost_center_id`… pero hoy ningún asiento lo setea. Hacerlo por esa
 * vía exigiría cablear centros de costo en cada posteo automático (compras, ventas, nómina): un
 * refactor cross-module. Se compone lo operativo, que es donde el costo real ya vive y está al día.
 * La vía contable queda como evolución para auditoría formal.
 *
 * `cost_centers` (que ya tiene CRUD en Finanzas) es OPCIONAL: sirve para nombrar/agrupar. Si no hay
 * fila para una entidad, igual aparece con su nombre natural — así el módulo es útil sin setup.
 */

/** Nivel de imputación. Cada uno tiene fuentes propias (ver `SOURCES`). */
export type CostLevel = 'lot' | 'animal' | 'crop' | 'machinery';
const LEVELS: CostLevel[] = ['lot', 'animal', 'crop', 'machinery'];

/** Categorías de costo y de qué hecho operativo sale cada una. */
export const COST_CATEGORIES = {
  health: 'Sanidad — tratamientos (producto valorizado al aplicar)',
  feed: 'Nutrición — entregas de ración a lote',
  crop: 'Agricultura — labores (insumos consumidos)',
  machinery: 'Maquinaria — combustible y mantenimiento',
} as const;
export type CostCategory = keyof typeof COST_CATEGORIES;

export interface CostsByCenterParams {
  level?: CostLevel;
  /** Inclusive; default: hace 365 días. */
  from?: string;
  /** Inclusive; default: hoy. */
  to?: string;
}

@Injectable()
export class CostingService {
  constructor(private readonly db: DbService) {}

  async costsByCenter(params: CostsByCenterParams = {}) {
    const level = params.level ?? 'lot';
    if (!LEVELS.includes(level))
      throw new BadRequestException({ code: 'costing.invalid_level', title: `Nivel inválido: ${level}. Válidos: ${LEVELS.join(', ')}` });

    const to = params.to ?? new Date().toISOString().slice(0, 10);
    const from = params.from ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
      throw new BadRequestException({ code: 'costing.invalid_range', title: 'from/to deben ser fechas válidas' });
    if (from > to) throw new BadRequestException({ code: 'costing.inverted_range', title: 'from no puede ser posterior a to' });

    const t = this.db.tenant;
    const rows = await this.db.query<any>(this.sqlFor(level), [t, from, to]);

    const out = rows.map((r) => {
      const categories = Object.fromEntries(
        (Object.keys(COST_CATEGORIES) as CostCategory[]).map((c) => [c, +(r[c] ?? 0)]),
      ) as Record<CostCategory, number>;
      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      return {
        level,
        reference_id: r.reference_id,
        name: r.name,
        cost_center_id: r.cost_center_id ?? null,
        categories,
        total: +total.toFixed(2),
      };
    });

    const byCategory = Object.fromEntries(
      (Object.keys(COST_CATEGORIES) as CostCategory[]).map((c) => [c, +out.reduce((a, r) => a + r.categories[c], 0).toFixed(2)]),
    ) as Record<CostCategory, number>;

    return {
      level,
      from,
      to,
      rows: out.sort((a, b) => b.total - a.total),
      totals: { by_category: byCategory, total: +Object.values(byCategory).reduce((a, b) => a + b, 0).toFixed(2) },
    };
  }

  /**
   * SQL por nivel. Cada nivel trae solo las categorías que le aplican (una máquina no come ración);
   * las demás quedan en 0 para que la forma de la respuesta sea estable.
   *
   * Imputación de SANIDAD al lote: por el lote ACTUAL del animal (`current_lot_id`), igual criterio
   * que ya usa Feedlot. Es una aproximación conocida —un animal movido arrastra su costo histórico
   * al lote nuevo—; la exacta requeriría reconstruir la pertenencia por fecha desde
   * `animal_movements`. A nivel ANIMAL la imputación es exacta.
   */
  private sqlFor(level: CostLevel): string {
    if (level === 'lot') {
      return `
        SELECT l.id AS reference_id, l.name,
               cc.id AS cost_center_id,
               COALESCE((SELECT sum(tr.cost) FROM treatments tr
                         JOIN animals a ON a.id = tr.animal_id AND a.current_lot_id = l.id
                         WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL AND tr.cost IS NOT NULL
                           AND tr.applied_at::date BETWEEN $2::date AND $3::date), 0)::float AS health,
               COALESCE((SELECT sum(fd.total_cost) FROM feed_deliveries fd
                         WHERE fd.lot_id = l.id AND fd.tenant_id = $1 AND fd.deleted_at IS NULL AND fd.total_cost IS NOT NULL
                           AND fd.delivered_at::date BETWEEN $2::date AND $3::date), 0)::float AS feed,
               0::float AS crop, 0::float AS machinery
        FROM lots l
        LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'lot' AND cc.reference_id = l.id AND cc.deleted_at IS NULL
        WHERE l.tenant_id = $1 AND l.deleted_at IS NULL`;
    }
    if (level === 'animal') {
      return `
        SELECT a.id AS reference_id, COALESCE(ai.value, a.id::text) AS name,
               cc.id AS cost_center_id,
               COALESCE(sum(tr.cost), 0)::float AS health,
               0::float AS feed, 0::float AS crop, 0::float AS machinery
        FROM animals a
        LEFT JOIN treatments tr ON tr.animal_id = a.id AND tr.tenant_id = $1 AND tr.deleted_at IS NULL
             AND tr.cost IS NOT NULL AND tr.applied_at::date BETWEEN $2::date AND $3::date
        LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual'
                           AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
        LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'animal' AND cc.reference_id = a.id AND cc.deleted_at IS NULL
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
        GROUP BY a.id, ai.value, cc.id
        HAVING COALESCE(sum(tr.cost), 0) > 0`;
    }
    if (level === 'crop') {
      return `
        SELECT c.id AS reference_id,
               -- crops no tiene columna de nombre: se compone del tipo + variedad (el potrero da contexto).
               concat_ws(' ', c.crop_type, c.variety, '·', p.name) AS name,
               cc.id AS cost_center_id,
               0::float AS health, 0::float AS feed,
               COALESCE(sum(co.cost), 0)::float AS crop,
               0::float AS machinery
        FROM crops c
        LEFT JOIN paddocks p ON p.id = c.paddock_id
        LEFT JOIN crop_operations co ON co.crop_id = c.id AND co.tenant_id = $1 AND co.deleted_at IS NULL
             AND co.cost IS NOT NULL AND co.performed_at::date BETWEEN $2::date AND $3::date
        LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'crop' AND cc.reference_id = c.id AND cc.deleted_at IS NULL
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        GROUP BY c.id, c.crop_type, c.variety, p.name, cc.id`;
    }
    // machinery: combustible + mantenimiento
    return `
      SELECT m.id AS reference_id, m.name,
             cc.id AS cost_center_id,
             0::float AS health, 0::float AS feed, 0::float AS crop,
             (COALESCE((SELECT sum(f.total_cost) FROM fuel_logs f
                        WHERE f.machinery_id = m.id AND f.tenant_id = $1 AND f.deleted_at IS NULL AND f.total_cost IS NOT NULL
                          AND f.fueled_at::date BETWEEN $2::date AND $3::date), 0)
            + COALESCE((SELECT sum(mr.cost) FROM maintenance_records mr
                        WHERE mr.machinery_id = m.id AND mr.tenant_id = $1 AND mr.deleted_at IS NULL AND mr.cost IS NOT NULL
                          AND mr.performed_at::date BETWEEN $2::date AND $3::date), 0))::float AS machinery
      FROM machinery m
      LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'machinery' AND cc.reference_id = m.id AND cc.deleted_at IS NULL
      WHERE m.tenant_id = $1 AND m.deleted_at IS NULL`;
  }
}
