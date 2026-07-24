import { BadRequestException, Injectable } from '@nestjs/common';
import { computeBudgetVariance, computeMargin, computeUnitCost } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { SALE_COUNTS } from '../commerce/sales.service';

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
  labor: 'Mano de obra — partes de trabajo valorizados a la tarifa del empleado',
} as const;
export type CostCategory = keyof typeof COST_CATEGORIES;

/** Niveles de rentabilidad (E3). `activity` compone E2; `lot`/`animal` componen E1. */
export type ProfitLevel = 'lot' | 'animal' | 'activity';
const PROFIT_LEVELS: ProfitLevel[] = ['lot', 'animal', 'activity'];
/** Clave para las ventas cuyo animal ya no pertenece a ningún lote (no se descartan: ver E3). */
const UNASSIGNED = '__unassigned__';
/** La regla de dominio devuelve camelCase; la API del repo habla snake_case. Un solo traductor. */
const margin = (input: { revenue: number; cost: number }) => {
  const m = computeMargin(input);
  return { margin: m.margin, margin_pct: m.marginPct, roi_pct: m.roiPct };
};

/** Actividades productivas con costo unitario propio (E2). */
export type ActivityKind = 'beef' | 'milk' | 'crop';

/**
 * Avisos cuando costo y producción no cierran. Casi siempre significan "falta clasificar algo"
 * —no "es gratis"—, así que el reporte lo dice en vez de mostrar un unitario vacío sin explicación.
 */
const ACTIVITY_NOTES: Record<ActivityKind, { costMissing: string; outputMissing: string }> = {
  beef: {
    costMissing: 'Hay kilos producidos pero ningún costo cargado en el período.',
    outputMissing: 'Hay costos pero no se registraron pesajes suficientes para medir los kilos producidos.',
  },
  milk: {
    costMissing: 'Hay litros producidos pero ningún lote con propósito «tambo» (dairy): el costo del tambo no se puede separar.',
    outputMissing: 'Hay costos de tambo pero no se registró producción de leche en el período.',
  },
  crop: {
    costMissing: 'Hay cosecha registrada pero ninguna labor con costo en el período.',
    outputMissing: 'Hay labores con costo pero todavía no se registró cosecha (el costo por hectárea sí es comparable).',
  },
};

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

    const { from, to } = this.range(params);
    const t = this.db.tenant;
    const [rows, labor] = await Promise.all([
      this.db.query<any>(this.sqlFor(level), [t, from, to]),
      this.db.query<any>(CostingService.LABOR_TOTALS_SQL, [t, from, to]),
    ]);

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

    // Mano de obra que NO llegó a ninguna fila: la valorizada pero sin centro atribuible, y las
    // horas sin tarifa. Se informan en vez de callarse — las dos abaratarían el costo en silencio.
    const laborTotal = +(labor[0]?.priced ?? 0);
    const attributedLabor = out.reduce((a, r) => a + r.categories.labor, 0);

    return {
      level,
      from,
      to,
      rows: out.sort((a, b) => b.total - a.total),
      totals: {
        by_category: byCategory,
        total: +Object.values(byCategory).reduce((a, b) => a + b, 0).toFixed(2),
        /** Jornadas valorizadas que no se pudieron imputar a un centro de este nivel. */
        unattributed_labor: +Math.max(0, laborTotal - attributedLabor).toFixed(2),
        /** Horas trabajadas por empleados sin tarifa horaria: costo real que el sistema no puede valorizar. */
        unpriced_hours: +(labor[0]?.unpriced_hours ?? 0),
      },
    };
  }

  /** Mano de obra del período a nivel finca: lo valorizable y lo que quedó sin tarifa. */
  private static readonly LABOR_TOTALS_SQL = `
    SELECT COALESCE(sum(wl.hours * e.hourly_rate) FILTER (WHERE e.hourly_rate IS NOT NULL), 0)::float AS priced,
           COALESCE(sum(wl.hours) FILTER (WHERE e.hourly_rate IS NULL), 0)::float AS unpriced_hours
    FROM work_logs wl
    JOIN employees e ON e.id = wl.employee_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
    WHERE wl.tenant_id = $1 AND wl.deleted_at IS NULL AND wl.hours IS NOT NULL
      AND wl.work_date BETWEEN $2::date AND $3::date`;

  /**
   * Costo UNITARIO por actividad (E2) — el número que vuelve accionable al costo: no importa haber
   * gastado $X, importa cuánto salió el kilo / el litro / la hectárea.
   *
   * ATRIBUCIÓN por PROPÓSITO DEL LOTE (`lots.purpose`), que es la clasificación explícita que el
   * productor ya carga. Leche = lotes 'dairy'; carne = todos los demás, incluidos los que no tienen
   * propósito cargado (el default sensato en un ERP ganadero argentino). Agricultura va por cultivo.
   * No se reparte automáticamente un costo compartido entre actividades: eso exigiría un criterio de
   * prorrateo (¿por cabeza? ¿por hectárea?) que el sistema no puede adivinar sin mentir.
   *
   * MAQUINARIA queda FUERA de las actividades a propósito: imputarla exigiría un driver de reparto
   * (horas de uso por actividad) que hoy no se registra. Sigue visible como centro propio en E1.
   *
   * `note` avisa cuando los dos lados no cierran —hay producción pero no costo, o al revés—, que en
   * la práctica significa "falta clasificar algo", no "es gratis".
   */
  async unitCosts(params: { from?: string; to?: string } = {}) {
    const { from, to } = this.range(params);
    const t = this.db.tenant;
    const p = [t, from, to];

    const [beef, milk, crop] = await Promise.all([
      this.db.query<any>(CostingService.BEEF_SQL, p),
      this.db.query<any>(CostingService.MILK_SQL, p),
      this.db.query<any>(CostingService.CROP_SQL, p),
    ]);

    const activities = [
      this.activity('beef', 'Carne', 'kg ganados', beef[0]),
      this.activity('milk', 'Leche', 'litros', milk[0]),
      this.activity('crop', 'Agricultura', crop[0]?.output_unit || 'kg', crop[0]),
    ];
    return { from, to, activities };
  }

  /**
   * REAL vs PRESUPUESTO por centro (E4) — para que el desvío se vea ANTES de fin de ejercicio, no
   * cuando ya no se puede corregir. El puente es `cost_centers`: una línea de presupuesto se imputa
   * a un centro (`budget_lines.cost_center_id`) y ese centro apunta a la misma entidad (lote/animal/
   * cultivo/máquina) que E1 costea, así que se comparan lado a lado con `computeBudgetVariance`
   * (la misma regla de dominio que ya usa Finanzas, sin duplicarla).
   *
   * EN QUÉ SE DIFERENCIA DE FINANZAS (BG-2): aquel enfrenta el presupuesto contra el LIBRO MAYOR;
   * este, contra los HECHOS OPERATIVOS —lo que este módulo eligió leer en E1—. Son dos vigilancias
   * distintas y ambas válidas: la contable (lo asentado) y la de gestión (lo que pasó en el campo,
   * que suele estar más al día). El costo operativo es siempre gasto, así que no hace falta
   * normalizar por tipo de cuenta: desvío positivo = sobregiro.
   *
   * Rango por defecto = el año fiscal del presupuesto. `over_budget` marca lo que ya se pasó.
   */
  async budgetVsActual(params: { budgetId: string; level?: CostLevel; from?: string; to?: string }) {
    const budgetId = String(params.budgetId ?? '').trim();
    if (!budgetId) throw new BadRequestException({ code: 'costing.missing_budget', title: 'budgetId es obligatorio' });
    const level = params.level ?? 'lot';
    if (!LEVELS.includes(level))
      throw new BadRequestException({ code: 'costing.invalid_level', title: `Nivel inválido: ${level}. Válidos: ${LEVELS.join(', ')}` });

    const t = this.db.tenant;
    const budget = await this.db.query<{ fiscal_year: number; name: string }>(
      `SELECT fiscal_year, name FROM budgets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [budgetId, t],
    );
    if (budget.length === 0) throw new BadRequestException({ code: 'costing.budget_not_found', title: 'Presupuesto no encontrado' });
    const fy = budget[0].fiscal_year;

    // Default: el año fiscal completo. Si el rango cae dentro del año, se acota también el mes de las
    // líneas presupuestarias, para que los dos lados miren la misma ventana.
    const from = params.from ?? `${fy}-01-01`;
    const to = params.to ?? `${fy}-12-31`;
    const { from: f, to: tt } = this.range({ from, to });
    const fromMonth = new Date(f).getUTCFullYear() === fy ? new Date(f).getUTCMonth() + 1 : 1;
    const toMonth = new Date(tt).getUTCFullYear() === fy ? new Date(tt).getUTCMonth() + 1 : 12;

    const [costs, budgetRows] = await Promise.all([
      this.costsByCenter({ level, from: f, to: tt }),
      this.db.query<any>(CostingService.BUDGET_BY_CC_SQL, [t, budgetId, level, fromMonth, toMonth]),
    ]);

    // Anclado en el CENTRO DE COSTO: es la unidad en la que se presupuesta. Un centro con
    // presupuesto y sin gasto (todavía no arrancó) tiene que verse; un gasto sin centro asignado no
    // es comparable —no hay contra qué— y se agrega aparte como "gasto no presupuestado", que es un
    // aviso en sí mismo.
    const byCc = new Map<string, { cost_center_id: string; reference_id: string | null; name: string; budget: number; actual: number }>();
    for (const b of budgetRows)
      byCc.set(b.cost_center_id, { cost_center_id: b.cost_center_id, reference_id: b.reference_id, name: b.name, budget: +b.budget, actual: 0 });

    let unbudgeted = 0;
    for (const c of costs.rows) {
      if (c.cost_center_id && byCc.has(c.cost_center_id)) byCc.get(c.cost_center_id)!.actual = c.total;
      else if (c.total > 0) unbudgeted += c.total;
    }

    const rows = [...byCc.values()].map((r) => {
      const { variance, variance_pct } = computeBudgetVariance(r.budget, r.actual);
      return {
        cost_center_id: r.cost_center_id,
        reference_id: r.reference_id,
        name: r.name,
        budget: +r.budget.toFixed(2),
        actual: +r.actual.toFixed(2),
        variance,
        variance_pct,
        over_budget: variance > 0,
      };
    });
    // Peor desvío primero: lo que más se pasó es lo que hay que mirar hoy.
    rows.sort((a, b) => b.variance - a.variance);

    const totBudget = rows.reduce((a, r) => a + r.budget, 0);
    const totActual = rows.reduce((a, r) => a + r.actual, 0);
    return {
      budget_id: budgetId,
      budget_name: budget[0].name,
      fiscal_year: fy,
      level,
      from: f,
      to: tt,
      rows,
      totals: {
        budget: +totBudget.toFixed(2),
        actual: +totActual.toFixed(2),
        ...computeBudgetVariance(totBudget, totActual),
        unbudgeted_actual: +unbudgeted.toFixed(2),
      },
    };
  }

  /** Presupuesto agregado por centro de costo del nivel pedido, dentro de la ventana de meses. */
  private static readonly BUDGET_BY_CC_SQL = `
    SELECT bl.cost_center_id, cc.reference_id, cc.name, sum(bl.amount)::float AS budget
    FROM budget_lines bl
    JOIN cost_centers cc ON cc.id = bl.cost_center_id AND cc.tenant_id = $1 AND cc.deleted_at IS NULL AND cc.level = $3
    WHERE bl.tenant_id = $1 AND bl.budget_id = $2 AND bl.deleted_at IS NULL
      AND bl.month BETWEEN $4 AND $5
    GROUP BY bl.cost_center_id, cc.reference_id, cc.name`;

  /**
   * RENTABILIDAD (E3) — cierra el circuito: ingresos − costos = margen, por lote, por animal o por
   * actividad. No recalcula costos: compone los motores de E1/E2, así "cuánto costó" tiene una sola
   * definición en todo el módulo.
   *
   * QUÉ CUENTA COMO INGRESO: `SALE_COUNTS` (la regla del módulo Comercial: ni borrador ni anulada),
   * devengado por fecha de venta. En leche se agrega el ANTI-DOBLE-CONTEO simétrico al de costos:
   * las remisiones a usina (`milk_deliveries`) se valorizan SOLO si todavía no están facturadas
   * (`sale_id IS NULL`); si ya tienen venta, el ingreso lo aporta la venta.
   *
   * Un lote sin ventas NO es un lote con pérdida total: es hacienda en pie. Por eso `margin_pct`
   * viene en null y no en −100 (regla `computeMargin`).
   */
  async profitability(params: { level?: ProfitLevel; from?: string; to?: string } = {}) {
    const level = params.level ?? 'lot';
    if (!PROFIT_LEVELS.includes(level))
      throw new BadRequestException({ code: 'costing.invalid_level', title: `Nivel inválido: ${level}. Válidos: ${PROFIT_LEVELS.join(', ')}` });
    const { from, to } = this.range(params);

    const rows = level === 'activity' ? await this.profitByActivity(from, to) : await this.profitByCenter(level, from, to);
    const totals = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost }), { revenue: 0, cost: 0 });

    return {
      level,
      from,
      to,
      rows: rows.sort((a, b) => b.margin - a.margin),
      totals: { revenue: +totals.revenue.toFixed(2), cost: +totals.cost.toFixed(2), ...margin(totals) },
    };
  }

  /** Lote o animal: costos de E1 + ingresos de las ventas atribuidas al mismo centro. */
  private async profitByCenter(level: 'lot' | 'animal', from: string, to: string) {
    const [costs, revenue] = await Promise.all([
      this.costsByCenter({ level, from, to }),
      this.db.query<any>(level === 'lot' ? CostingService.REVENUE_BY_LOT_SQL : CostingService.REVENUE_BY_ANIMAL_SQL, [this.db.tenant, from, to]),
    ]);

    // Unión, no intersección: un animal vendido sin costos imputados igual tiene que aparecer (su
    // margen es todo ganancia aparente, que es justamente lo que hay que ver), y un lote con costos
    // y sin ventas también. Quedarse con un solo lado escondería la mitad del negocio.
    const merged = new Map<string, { reference_id: string | null; name: string; revenue: number; cost: number }>();
    const keyOf = (id: string | null) => id ?? UNASSIGNED;
    for (const c of costs.rows) merged.set(keyOf(c.reference_id), { reference_id: c.reference_id, name: c.name, revenue: 0, cost: c.total });
    for (const r of revenue) {
      const key = keyOf(r.reference_id);
      const prev = merged.get(key);
      // reference_id null = ventas de animales que ya no están en ningún lote. Se muestran aparte en
      // vez de descartarlas: si no, los totales de rentabilidad no cerrarían con los de ventas.
      if (prev) prev.revenue += +r.revenue;
      else merged.set(key, { reference_id: r.reference_id, name: r.name ?? 'Sin lote asignado', revenue: +r.revenue, cost: 0 });
    }

    return [...merged.values()].map((r) => ({
      reference_id: r.reference_id,
      name: r.name,
      revenue: +r.revenue.toFixed(2),
      cost: +r.cost.toFixed(2),
      ...margin(r),
    }));
  }

  /** Actividad: costos y producción de E2 + ingresos por tipo de venta. Suma el margen por unidad. */
  private async profitByActivity(from: string, to: string) {
    const [unit, revenue] = await Promise.all([
      this.unitCosts({ from, to }),
      this.db.query<any>(CostingService.REVENUE_BY_ACTIVITY_SQL, [this.db.tenant, from, to]),
    ]);
    const byActivity = new Map(revenue.map((r) => [r.activity as ActivityKind, +r.revenue]));

    return unit.activities.map((a) => {
      const rev = byActivity.get(a.activity) ?? 0;
      const m = margin({ revenue: rev, cost: a.cost });
      return {
        reference_id: a.activity,
        name: a.label,
        revenue: +rev.toFixed(2),
        cost: a.cost,
        ...m,
        output: a.output,
        output_unit: a.output_unit,
        unit_cost: a.unit_cost,
        /** Lo que deja cada kilo/litro producido — el número con el que se decide seguir o parar. */
        margin_per_unit: computeUnitCost({ totalCost: m.margin, output: a.output }).unitCost,
      };
    });
  }

  /** Ingresos por LOTE: por el lote actual del animal vendido (misma aproximación que los costos). */
  private static readonly REVENUE_BY_LOT_SQL = `
    SELECT a.current_lot_id AS reference_id, NULL::text AS name, sum(sl.line_total)::float AS revenue
    FROM sale_lines sl
    JOIN sales sa ON sa.id = sl.sale_id AND sa.tenant_id = $1 AND sa.deleted_at IS NULL AND ${SALE_COUNTS}
         AND sa.sale_date BETWEEN $2::date AND $3::date
    JOIN animals a ON a.id = sl.animal_id AND a.tenant_id = $1
    WHERE sl.tenant_id = $1 AND sl.deleted_at IS NULL AND sl.animal_id IS NOT NULL
    GROUP BY a.current_lot_id`;

  /** Ingresos por ANIMAL: exactos, la línea de venta apunta al animal. */
  private static readonly REVENUE_BY_ANIMAL_SQL = `
    SELECT sl.animal_id AS reference_id,
           COALESCE((SELECT value FROM animal_identifiers x WHERE x.animal_id = sl.animal_id AND x.type='visual'
                     AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1), sl.animal_id::text) AS name,
           sum(sl.line_total)::float AS revenue
    FROM sale_lines sl
    JOIN sales sa ON sa.id = sl.sale_id AND sa.tenant_id = $1 AND sa.deleted_at IS NULL AND ${SALE_COUNTS}
         AND sa.sale_date BETWEEN $2::date AND $3::date
    WHERE sl.tenant_id = $1 AND sl.deleted_at IS NULL AND sl.animal_id IS NOT NULL
    GROUP BY sl.animal_id`;

  /**
   * Ingresos por ACTIVIDAD: el tipo de venta ya clasifica (livestock/milk/crop). Se agrega la leche
   * remitida y AÚN NO facturada (`sale_id IS NULL`) valorizada a su precio por litro — si tuviera
   * venta asociada se contaría dos veces.
   */
  private static readonly REVENUE_BY_ACTIVITY_SQL = `
    SELECT act AS activity, sum(revenue)::float AS revenue FROM (
      SELECT CASE sa.type WHEN 'livestock' THEN 'beef' WHEN 'milk' THEN 'milk' WHEN 'crop' THEN 'crop' END AS act,
             sa.total AS revenue
      FROM sales sa
      WHERE sa.tenant_id = $1 AND sa.deleted_at IS NULL AND ${SALE_COUNTS}
        AND sa.sale_date BETWEEN $2::date AND $3::date AND sa.type IN ('livestock','milk','crop')
      UNION ALL
      SELECT 'milk' AS act, (md.liters * md.price_per_liter) AS revenue
      FROM milk_deliveries md
      WHERE md.tenant_id = $1 AND md.deleted_at IS NULL AND md.sale_id IS NULL AND md.price_per_liter IS NOT NULL
        AND md.delivered_at::date BETWEEN $2::date AND $3::date
    ) s WHERE act IS NOT NULL GROUP BY act`;

  private activity(activity: ActivityKind, label: string, outputUnit: string, r: any) {
    const cost = +(r?.cost ?? 0);
    const output = +(r?.output ?? 0);
    const areaHa = r?.area_ha != null ? +r.area_ha : null;
    const { unitCost, costPerHa } = computeUnitCost({ totalCost: cost, output, areaHa });

    let note: string | null = null;
    if (output > 0 && cost <= 0) note = ACTIVITY_NOTES[activity].costMissing;
    else if (cost > 0 && output <= 0) note = ACTIVITY_NOTES[activity].outputMissing;

    // Producción SIN costo atribuido: aritméticamente el unitario da 0 (la regla de dominio hace
    // bien su trabajo: cero es un costo válido), pero mostrar "$0 el litro" se lee como "gratis"
    // cuando en realidad falta clasificar. Se oculta el número y queda la explicación en `note`.
    const unattributed = output > 0 && cost <= 0;

    return {
      activity,
      label,
      cost: +cost.toFixed(2),
      output: +output.toFixed(3),
      output_unit: outputUnit,
      unit_cost: unattributed ? null : unitCost,
      cost_per_ha: unattributed ? null : costPerHa,
      detail: { lots: r?.lots != null ? +r.lots : null, head: r?.head != null ? +r.head : null, crops: r?.crops != null ? +r.crops : null, area_ha: areaHa },
      note,
    };
  }

  /** Rango por defecto: último año. Compartido por todos los reportes del módulo. */
  private range(params: { from?: string; to?: string }) {
    const to = params.to ?? new Date().toISOString().slice(0, 10);
    const from = params.from ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
      throw new BadRequestException({ code: 'costing.invalid_range', title: 'from/to deben ser fechas válidas' });
    if (from > to) throw new BadRequestException({ code: 'costing.inverted_range', title: 'from no puede ser posterior a to' });
    return { from, to };
  }

  /**
   * CARNE. Producción = kg ganados en el período: por animal, último peso menos primer peso DENTRO
   * del rango (mismo criterio que engorde). Se suma algebraicamente: si el rodeo perdió peso, eso es
   * lo que pasó, no se esconde tomando solo las ganancias.
   */
  private static readonly BEEF_SQL = `
    WITH scope AS (
      SELECT id FROM lots WHERE tenant_id = $1 AND deleted_at IS NULL AND purpose IS DISTINCT FROM 'dairy'
    ),
    an AS (
      SELECT id FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL AND current_lot_id IN (SELECT id FROM scope)
    ),
    gains AS (
      SELECT (SELECT weight_kg FROM weighings x WHERE x.animal_id = w.animal_id AND x.tenant_id = $1 AND x.deleted_at IS NULL
                AND x.weighed_at::date BETWEEN $2::date AND $3::date ORDER BY x.weighed_at DESC, x.id DESC LIMIT 1)
           - (SELECT weight_kg FROM weighings x WHERE x.animal_id = w.animal_id AND x.tenant_id = $1 AND x.deleted_at IS NULL
                AND x.weighed_at::date BETWEEN $2::date AND $3::date ORDER BY x.weighed_at ASC, x.id ASC LIMIT 1) AS gained
      FROM (SELECT DISTINCT animal_id FROM weighings
            WHERE tenant_id = $1 AND deleted_at IS NULL AND weighed_at::date BETWEEN $2::date AND $3::date
              AND animal_id IN (SELECT id FROM an)) w
    )
    SELECT (SELECT count(*)::int FROM scope) AS lots,
           (SELECT count(*)::int FROM an) AS head,
           COALESCE((SELECT sum(gained) FROM gains), 0)::float AS output,
           (COALESCE((SELECT sum(tr.cost) FROM treatments tr WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL AND tr.cost IS NOT NULL
                        AND tr.applied_at::date BETWEEN $2::date AND $3::date AND tr.animal_id IN (SELECT id FROM an)), 0)
          + COALESCE((SELECT sum(fd.total_cost) FROM feed_deliveries fd WHERE fd.tenant_id = $1 AND fd.deleted_at IS NULL AND fd.total_cost IS NOT NULL
                        AND fd.delivered_at::date BETWEEN $2::date AND $3::date AND fd.lot_id IN (SELECT id FROM scope)), 0)
          + COALESCE((SELECT sum(wl.hours * e.hourly_rate) FROM work_logs wl
                        JOIN employees e ON e.id = wl.employee_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
                        LEFT JOIN cost_centers wcc ON wcc.id = wl.cost_center_id AND wcc.level = 'lot' AND wcc.deleted_at IS NULL
                        LEFT JOIN tasks tk ON tk.id = wl.task_id AND tk.related_type = 'lot' AND tk.deleted_at IS NULL
                        WHERE wl.tenant_id = $1 AND wl.deleted_at IS NULL AND wl.hours IS NOT NULL AND e.hourly_rate IS NOT NULL
                          AND wl.work_date BETWEEN $2::date AND $3::date
                          AND COALESCE(wcc.reference_id, tk.related_id) IN (SELECT id FROM scope)), 0))::float AS cost`;

  /** LECHE. Producción = litros del período. Costo = sanidad + ración de los lotes 'dairy'. */
  private static readonly MILK_SQL = `
    WITH scope AS (
      SELECT id FROM lots WHERE tenant_id = $1 AND deleted_at IS NULL AND purpose = 'dairy'
    ),
    an AS (
      SELECT id FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL AND current_lot_id IN (SELECT id FROM scope)
    )
    SELECT (SELECT count(*)::int FROM scope) AS lots,
           (SELECT count(*)::int FROM an) AS head,
           COALESCE((SELECT sum(m.total_liters) FROM milk_production_daily m
                     WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.production_date BETWEEN $2::date AND $3::date), 0)::float AS output,
           (COALESCE((SELECT sum(tr.cost) FROM treatments tr WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL AND tr.cost IS NOT NULL
                        AND tr.applied_at::date BETWEEN $2::date AND $3::date AND tr.animal_id IN (SELECT id FROM an)), 0)
          + COALESCE((SELECT sum(fd.total_cost) FROM feed_deliveries fd WHERE fd.tenant_id = $1 AND fd.deleted_at IS NULL AND fd.total_cost IS NOT NULL
                        AND fd.delivered_at::date BETWEEN $2::date AND $3::date AND fd.lot_id IN (SELECT id FROM scope)), 0)
          + COALESCE((SELECT sum(wl.hours * e.hourly_rate) FROM work_logs wl
                        JOIN employees e ON e.id = wl.employee_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
                        LEFT JOIN cost_centers wcc ON wcc.id = wl.cost_center_id AND wcc.level = 'lot' AND wcc.deleted_at IS NULL
                        LEFT JOIN tasks tk ON tk.id = wl.task_id AND tk.related_type = 'lot' AND tk.deleted_at IS NULL
                        WHERE wl.tenant_id = $1 AND wl.deleted_at IS NULL AND wl.hours IS NOT NULL AND e.hourly_rate IS NOT NULL
                          AND wl.work_date BETWEEN $2::date AND $3::date
                          AND COALESCE(wcc.reference_id, tk.related_id) IN (SELECT id FROM scope)), 0))::float AS cost`;

  /**
   * AGRICULTURA. Producción = lo cosechado en el período; superficie = la de los cultivos cosechados
   * (habilita el costo por hectárea, que es como se compara agricultura). La unidad se toma de la
   * más frecuente en `harvests.yield_unit`: si conviven kg y toneladas el total no es homogéneo, y
   * eso es un problema de carga que el reporte no debe disimular convirtiendo por su cuenta.
   */
  private static readonly CROP_SQL = `
    WITH h AS (
      SELECT hv.crop_id, hv.yield_quantity, hv.yield_unit
      FROM harvests hv WHERE hv.tenant_id = $1 AND hv.deleted_at IS NULL AND hv.harvest_date BETWEEN $2::date AND $3::date
    )
    SELECT (SELECT count(DISTINCT crop_id)::int FROM h) AS crops,
           COALESCE((SELECT sum(yield_quantity) FROM h), 0)::float AS output,
           (SELECT COALESCE(yield_unit, 'kg') FROM h WHERE yield_unit IS NOT NULL
            GROUP BY yield_unit ORDER BY sum(yield_quantity) DESC LIMIT 1) AS output_unit,
           (SELECT sum(c.area_ha)::float FROM crops c WHERE c.id IN (SELECT crop_id FROM h)) AS area_ha,
           (COALESCE((SELECT sum(co.cost) FROM crop_operations co
                      WHERE co.tenant_id = $1 AND co.deleted_at IS NULL AND co.cost IS NOT NULL
                        AND co.performed_at::date BETWEEN $2::date AND $3::date), 0)
          + COALESCE((SELECT sum(wl.hours * e.hourly_rate) FROM work_logs wl
                      JOIN employees e ON e.id = wl.employee_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
                      LEFT JOIN cost_centers wcc ON wcc.id = wl.cost_center_id AND wcc.level = 'crop' AND wcc.deleted_at IS NULL
                      LEFT JOIN tasks tk ON tk.id = wl.task_id AND tk.related_type = 'crop' AND tk.deleted_at IS NULL
                      WHERE wl.tenant_id = $1 AND wl.deleted_at IS NULL AND wl.hours IS NOT NULL AND e.hourly_rate IS NOT NULL
                        AND wl.work_date BETWEEN $2::date AND $3::date
                        AND COALESCE(wcc.reference_id, tk.related_id) IS NOT NULL), 0))::float AS cost`;

  /**
   * MANO DE OBRA (E6) — valoriza los partes de trabajo (`work_logs`, WL-1), que hasta acá registraban
   * horas sin precio y quedaban fuera del costeo.
   *
   * Valorización: `hours × employees.hourly_rate`. Un empleado SIN tarifa no aporta costo cero —eso
   * sería trabajo gratis—: sus horas se excluyen y se informan aparte en `totals.unpriced_hours`,
   * para que la falta de dato se vea en vez de abaratar el costo.
   *
   * ATRIBUCIÓN, regla única en dos pasos (el primero que exista gana):
   *   1. `work_logs.cost_center_id` — imputación EXPLÍCITA de la jornada.
   *   2. la tarea vinculada (`work_logs.task_id` → `tasks.related_type/related_id`) — DERIVADA: si la
   *      tarea era de un lote, la jornada se imputa a ese lote. Aprovecha lo que el módulo de Tareas
   *      ya registra, sin pedirle al productor que cargue el dato dos veces.
   * Sin ninguno de los dos, la jornada no se atribuye a un centro (aparece en `unattributed_labor`).
   *
   * `level` viene del enum validado en `costsByCenter`, nunca del request crudo.
   */
  private laborSql(level: CostLevel, entityCol: string): string {
    return `COALESCE((SELECT sum(wl.hours * e.hourly_rate) FROM work_logs wl
              JOIN employees e ON e.id = wl.employee_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
              LEFT JOIN cost_centers wcc ON wcc.id = wl.cost_center_id AND wcc.level = '${level}' AND wcc.deleted_at IS NULL
              LEFT JOIN tasks tk ON tk.id = wl.task_id AND tk.related_type = '${level}' AND tk.deleted_at IS NULL
              WHERE wl.tenant_id = $1 AND wl.deleted_at IS NULL
                AND wl.hours IS NOT NULL AND e.hourly_rate IS NOT NULL
                AND wl.work_date BETWEEN $2::date AND $3::date
                AND COALESCE(wcc.reference_id, tk.related_id) = ${entityCol}), 0)::float`;
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
               0::float AS crop, 0::float AS machinery,
               ${this.laborSql('lot', 'l.id')} AS labor
        FROM lots l
        LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'lot' AND cc.reference_id = l.id AND cc.deleted_at IS NULL
        WHERE l.tenant_id = $1 AND l.deleted_at IS NULL`;
    }
    if (level === 'animal') {
      // Se envuelve en una subconsulta para poder filtrar por el TOTAL (sanidad + mano de obra):
      // un animal cuyo único costo es la jornada imputada tiene que aparecer igual.
      return `
        SELECT * FROM (
          SELECT a.id AS reference_id, COALESCE(ai.value, a.id::text) AS name,
                 cc.id AS cost_center_id,
                 COALESCE((SELECT sum(tr.cost) FROM treatments tr
                           WHERE tr.animal_id = a.id AND tr.tenant_id = $1 AND tr.deleted_at IS NULL
                             AND tr.cost IS NOT NULL AND tr.applied_at::date BETWEEN $2::date AND $3::date), 0)::float AS health,
                 0::float AS feed, 0::float AS crop, 0::float AS machinery,
                 ${this.laborSql('animal', 'a.id')} AS labor
          FROM animals a
          LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual'
                             AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
          LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'animal' AND cc.reference_id = a.id AND cc.deleted_at IS NULL
          WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
        ) t WHERE t.health > 0 OR t.labor > 0`;
    }
    if (level === 'crop') {
      return `
        SELECT c.id AS reference_id,
               -- crops no tiene columna de nombre: se compone del tipo + variedad (el potrero da contexto).
               concat_ws(' ', c.crop_type, c.variety, '·', p.name) AS name,
               cc.id AS cost_center_id,
               0::float AS health, 0::float AS feed,
               COALESCE(sum(co.cost), 0)::float AS crop,
               0::float AS machinery,
               ${this.laborSql('crop', 'c.id')} AS labor
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
                          AND mr.performed_at::date BETWEEN $2::date AND $3::date), 0))::float AS machinery,
             ${this.laborSql('machinery', 'm.id')} AS labor
      FROM machinery m
      LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.level = 'machinery' AND cc.reference_id = m.id AND cc.deleted_at IS NULL
      WHERE m.tenant_id = $1 AND m.deleted_at IS NULL`;
  }
}
