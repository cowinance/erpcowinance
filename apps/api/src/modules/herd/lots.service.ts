import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidLotError, Sex, computeFeedlotMetrics, validateLotInput } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Lotes y rodeos (B1): alta, listado, detalle, métricas, alertas operativas, edición, archivado e
 * historial de rotación.
 *
 * SEPARADO de `HerdService` porque son dos cosas distintas que solo comparten la base: el animal es
 * el maestro individual y el lote es la unidad de MANEJO. Estaban juntas porque crecieron juntas, y
 * `herd.service.ts` había llegado a 1417 líneas — cuatro veces el tamaño en que un servicio deja de
 * poder revisarse de una sentada. Nada de lo que sigue tocaba `AnimalWriteService` ni `Billing`: la
 * costura ya estaba, solo faltaba cortar por ahí.
 *
 * REGLA QUE NO CAMBIA: un animal NUNCA cambia de lote con un UPDATE directo a `current_lot_id`.
 * Los movimientos pasan por `MovementService` (P3), que registra el hecho. Acá no se mueven
 * animales: se administra el lote.
 */
@Injectable()
export class LotsService {
  constructor(private readonly db: DbService) {}

  /** Crea un lote (rodeo/grupo de manejo) del tenant. `purpose` opcional (validado). */
  /**
   * Reglas de alertas operativas + estado del lote (Etapa 5), fuente única para el detalle y la lista.
   * `alerts`: sin potrero, sin pesaje reciente (>90 días), sin identificación, mezcla inusual de
   * categorías (>2), lote vacío. `status`: archived | empty | alert | active.
   */
  private computeLotAlerts(a: { isActive: boolean; head: number; paddockId: string | null; sinId: number; sinPesaje: number; categorias: number }) {
    const alerts: { code: string; label: string; severity: 'info' | 'warning' }[] = [];
    if (a.head === 0) {
      if (a.isActive) alerts.push({ code: 'empty', label: 'Lote vacío', severity: 'info' });
    } else {
      if (!a.paddockId) alerts.push({ code: 'no_paddock', label: 'Sin potrero asignado', severity: 'warning' });
      if (a.sinId > 0) alerts.push({ code: 'no_id', label: `${a.sinId} sin identificación`, severity: 'warning' });
      if (a.sinPesaje > 0) alerts.push({ code: 'no_weight', label: `${a.sinPesaje} sin pesaje reciente`, severity: 'info' });
      if (a.categorias > 2) alerts.push({ code: 'mixed', label: 'Mezcla inusual de categorías', severity: 'info' });
    }
    const status = !a.isActive ? 'archived' : a.head === 0 ? 'empty' : alerts.length ? 'alert' : 'active';
    return { status, alerts };
  }

  private validateLot<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidLotError) throw new BadRequestException({ code: 'lot.invalid', title: e.reason });
      throw e;
    }
  }

  async createLot(body: any) {
    const input = this.validateLot(() => validateLotInput(body));
    const t = this.db.tenant;
    const farm = (await this.db.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]))?.id;
    if (!farm) throw new BadRequestException({ code: 'lot.no_farm', title: 'No hay finca para asociar el lote' });
    return this.db.one<any>(
      `INSERT INTO lots (tenant_id, farm_id, name, purpose) VALUES ($1,$2,$3,$4) RETURNING id, name, purpose, is_active`,
      [t, farm, input.name, input.purpose],
    );
  }

  /**
   * Listado de lotes con sus contadores.
   *
   * Los agregados de peso van contra `weighings`, la TABLA, y no contra `v_weighings`, la vista.
   * La vista existe para derivar la GDP con un `LAG` sobre los pesajes de cada animal; acá se
   * necesita el último peso y si existe un pesaje reciente, y ninguna de las dos cosas la usa. Al
   * consultarla desde un LATERAL por animal, cada lote pagaba el cálculo de esa ventana tantas
   * veces como animales tuviera: con 3.000 animales, este listado de SEIS filas tardaba 5 segundos.
   *
   * `lotMetrics` sí conserva la vista, porque ahí la GDP se usa de verdad.
   */
  async lots(includeArchived = false) {
    const rows = await this.db.query<any>(
      `SELECT l.id, l.name, l.purpose, l.is_active, l.current_paddock_id, p.name AS paddock_name,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS animal_count,
              (SELECT round(avg(lw.weight_kg))::int FROM animals a
                 LEFT JOIN LATERAL (SELECT weight_kg FROM weighings w WHERE w.animal_id=a.id AND w.tenant_id=l.tenant_id AND w.deleted_at IS NULL ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) lw ON true
                 WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS avg_weight_kg,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL
                 AND NOT EXISTS(SELECT 1 FROM animal_identifiers ai WHERE ai.animal_id=a.id AND ai.type='visual' AND ai.deleted_at IS NULL)) AS sin_id,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL
                 AND NOT EXISTS(SELECT 1 FROM weighings w WHERE w.animal_id=a.id AND w.tenant_id=a.tenant_id AND w.deleted_at IS NULL AND w.weighed_at >= CURRENT_DATE - 90)) AS sin_pesaje,
              (SELECT count(DISTINCT a.category_id)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS categorias
       FROM lots l LEFT JOIN paddocks p ON p.id = l.current_paddock_id
       WHERE l.tenant_id = $1 AND (l.deleted_at IS NULL OR $2) ORDER BY l.is_active DESC, l.name`,
      [this.db.tenant, includeArchived],
    );
    return rows.map((l) => {
      const { status, alerts } = this.computeLotAlerts({ isActive: l.is_active, head: l.animal_count, paddockId: l.current_paddock_id, sinId: l.sin_id, sinPesaje: l.sin_pesaje, categorias: l.categorias });
      return { id: l.id, name: l.name, purpose: l.purpose, is_active: l.is_active, paddock_name: l.paddock_name, animal_count: l.animal_count, avg_weight_kg: l.avg_weight_kg, status, alert_count: alerts.length };
    });
  }

  /**
   * Métricas específicas según el PROPÓSITO del lote (Etapa 4). Reusa la infraestructura existente:
   * feedlot (computeFeedlotMetrics), pregnancies, v_weighings, animal_movements, milk_production_daily,
   * treatments. Sobre los animales activos del lote; derivado, nada se persiste.
   */
  async lotMetrics(id: string, targetWeight?: number) {
    const t = this.db.tenant;
    const lot = await this.db.one<any>(`SELECT id, purpose FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const inLot = `a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL`;

    switch (lot.purpose) {
      case 'fattening': {
        const [agg] = await this.db.query<any>(
          `WITH per AS (
             SELECT a.id,
               (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at ASC, created_at ASC, id ASC LIMIT 1) AS first_w,
               (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS last_w,
               (SELECT adg_since_last FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS adg
             FROM animals a WHERE ${inLot})
           SELECT (SELECT count(*) FROM per)::int AS head,
                  (SELECT avg(last_w) FROM per)::float AS avg_weight_kg,
                  (SELECT avg(adg) FROM per WHERE adg IS NOT NULL)::float AS avg_adg,
                  COALESCE((SELECT sum(last_w-first_w) FROM per WHERE last_w IS NOT NULL AND first_w IS NOT NULL),0)::float AS kg_gained,
                  COALESCE((SELECT sum(quantity_kg) FROM feed_deliveries fd WHERE fd.lot_id=$1 AND fd.tenant_id=$2 AND fd.deleted_at IS NULL),0)::float AS feed_kg,
                  COALESCE((SELECT sum(total_cost) FROM feed_deliveries fd WHERE fd.lot_id=$1 AND fd.tenant_id=$2 AND fd.deleted_at IS NULL),0)::float AS feed_cost`,
          [id, t],
        );
        const m = computeFeedlotMetrics({ feedKg: agg.feed_kg, feedCost: agg.feed_cost, kgGained: agg.kg_gained, avgWeightKg: agg.avg_weight_kg, avgAdg: agg.avg_adg, targetWeightKg: targetWeight ?? null });
        return { purpose: lot.purpose, metrics: { head: agg.head, feed_kg: agg.feed_kg, feed_cost: agg.feed_cost, kg_gained: agg.kg_gained, avg_weight_kg: agg.avg_weight_kg, avg_adg: agg.avg_adg, conversion: m.conversion, cost_per_kg_gained: m.costPerKgGained, days_to_finish: m.daysToFinish } };
      }
      case 'breeding': {
        const [r] = await this.db.query<any>(
          `SELECT count(*) FILTER (WHERE c.code IN ('vaca','vaquillona'))::int AS vientres,
                  count(*) FILTER (WHERE c.code='toro')::int AS toros,
                  count(*) FILTER (WHERE c.code IN ('ternero','ternera'))::int AS crias_al_pie,
                  count(*) FILTER (WHERE c.code IN ('vaca','vaquillona') AND EXISTS(SELECT 1 FROM pregnancies pr WHERE pr.animal_id=a.id AND pr.status='open' AND pr.deleted_at IS NULL))::int AS prenadas
           FROM animals a LEFT JOIN animal_categories c ON c.id=a.category_id WHERE ${inLot}`,
          [id, t],
        );
        return { purpose: lot.purpose, metrics: { vientres: r.vientres, toros: r.toros, prenadas: r.prenadas, vacias: Math.max(0, r.vientres - r.prenadas), crias_al_pie: r.crias_al_pie } };
      }
      case 'weaning': {
        const [r] = await this.db.query<any>(
          `WITH per AS (
             SELECT a.id, a.birth_date AS bd,
               (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at ASC, created_at ASC, id ASC LIMIT 1) AS first_w,
               (SELECT weight_kg FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS last_w,
               (SELECT adg_since_last FROM v_weighings w WHERE w.animal_id=a.id AND w.tenant_id=$2 ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) AS adg
             FROM animals a WHERE ${inLot})
           SELECT count(*)::int AS head, round(avg(first_w))::int AS peso_inicial, round(avg(last_w))::int AS peso_actual,
                  round(avg(adg)::numeric,2)::float AS gdp,
                  round(avg((CURRENT_DATE - bd)/30.44)::numeric,1)::float AS edad_prom_meses FROM per`,
          [id, t],
        );
        return { purpose: lot.purpose, metrics: r };
      }
      case 'hospital': {
        const [r] = await this.db.query<any>(
          `SELECT count(*)::int AS head,
                  round(avg(CURRENT_DATE - entry.d)::numeric,0)::int AS dias_promedio,
                  count(*) FILTER (WHERE EXISTS(SELECT 1 FROM treatments tr WHERE tr.animal_id=a.id AND tr.deleted_at IS NULL AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now())))::int AS tratamientos_vigentes
           FROM animals a
           LEFT JOIN LATERAL (SELECT max(moved_at)::date AS d FROM animal_movements m WHERE m.animal_id=a.id AND m.to_lot_id=$1 AND m.deleted_at IS NULL) entry ON true
           WHERE ${inLot}`,
          [id, t],
        );
        return { purpose: lot.purpose, metrics: r };
      }
      case 'quarantine': {
        const [r] = await this.db.query<any>(
          `WITH per AS (
             SELECT (SELECT max(moved_at)::date FROM animal_movements m WHERE m.animal_id=a.id AND m.to_lot_id=$1 AND m.deleted_at IS NULL) AS d
             FROM animals a WHERE ${inLot})
           SELECT count(*)::int AS head, min(d)::text AS fecha_ingreso,
                  (CURRENT_DATE - min(d))::int AS dias, (min(d) + 21)::text AS fecha_liberacion FROM per`,
          [id, t],
        );
        return { purpose: lot.purpose, metrics: r };
      }
      case 'dairy': {
        const [r] = await this.db.query<any>(
          `SELECT count(*)::int AS head,
                  round(avg(mp.liters)::numeric,1)::float AS litros_prom_dia,
                  count(*) FILTER (WHERE mp.liters IS NOT NULL)::int AS en_ordene,
                  count(*) FILTER (WHERE EXISTS(SELECT 1 FROM pregnancies pr WHERE pr.animal_id=a.id AND pr.status='open' AND pr.deleted_at IS NULL))::int AS prenadas
           FROM animals a
           LEFT JOIN LATERAL (SELECT avg(total_liters)::float AS liters FROM milk_production_daily md WHERE md.animal_id=a.id AND md.deleted_at IS NULL AND md.production_date >= CURRENT_DATE - 7) mp ON true
           WHERE ${inLot}`,
          [id, t],
        );
        return { purpose: lot.purpose, metrics: r };
      }
      default:
        return { purpose: lot.purpose, metrics: null };
    }
  }

  /** Detalle del lote: propósito, potrero, estado + composición (categoría/sexo) y agregados (peso, GDP). */
  async getLot(id: string) {
    const t = this.db.tenant;
    const lot = await this.db.one<any>(
      `SELECT l.id, l.name, l.purpose, l.is_active, l.current_paddock_id, p.name AS paddock_name
       FROM lots l LEFT JOIN paddocks p ON p.id = l.current_paddock_id
       WHERE l.id=$1 AND l.tenant_id=$2 AND l.deleted_at IS NULL`,
      [id, t],
    );
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const [agg, byCategory, bySex, checks] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*)::int AS head,
                round(avg(lw.weight_kg))::int AS avg_weight_kg,
                round(avg(lw.adg)::numeric, 2)::float AS avg_gdp
         FROM animals a
         LEFT JOIN LATERAL (SELECT weight_kg, adg_since_last AS adg FROM v_weighings w WHERE w.animal_id=a.id AND w.deleted_at IS NULL ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) lw ON true
         WHERE a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL`,
        [id, t],
      ),
      this.db.query<any>(
        `SELECT COALESCE(c.name, 'Sin categoría') AS category, count(*)::int AS n
         FROM animals a LEFT JOIN animal_categories c ON c.id=a.category_id
         WHERE a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL
         GROUP BY c.name ORDER BY n DESC`,
        [id, t],
      ),
      this.db.query<any>(
        `SELECT a.sex, count(*)::int AS n FROM animals a
         WHERE a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL GROUP BY a.sex`,
        [id, t],
      ),
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM animal_identifiers ai WHERE ai.animal_id=a.id AND ai.type='visual' AND ai.deleted_at IS NULL))::int AS sin_id,
                count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM weighings w WHERE w.animal_id=a.id AND w.tenant_id=a.tenant_id AND w.deleted_at IS NULL AND w.weighed_at >= CURRENT_DATE - 90))::int AS sin_pesaje,
                count(DISTINCT a.category_id)::int AS categorias
         FROM animals a WHERE a.current_lot_id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.deleted_at IS NULL`,
        [id, t],
      ),
    ]);
    const head = agg?.head ?? 0;
    const { status, alerts } = this.computeLotAlerts({
      isActive: lot.is_active, head, paddockId: lot.current_paddock_id,
      sinId: checks?.sin_id ?? 0, sinPesaje: checks?.sin_pesaje ?? 0, categorias: checks?.categorias ?? 0,
    });
    return { ...lot, head, avg_weight_kg: agg?.avg_weight_kg ?? null, avg_gdp: agg?.avg_gdp ?? null, by_category: byCategory, by_sex: bySex, status, alerts };
  }

  /** Edita nombre, propósito, potrero asignado y/o estado. El potrero debe pertenecer al tenant. */
  async updateLot(id: string, body: any) {
    const t = this.db.tenant;
    const existing = await this.db.one<any>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!existing) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const sets: string[] = [];
    const args: any[] = [id, t];
    if (body?.name !== undefined || body?.purpose !== undefined) {
      // Reusa la regla única para nombre/propósito (usa el nombre actual si sólo cambia el propósito).
      const current = await this.db.one<any>(`SELECT name FROM lots WHERE id=$1 AND tenant_id=$2`, [id, t]);
      const input = this.validateLot(() => validateLotInput({ name: body?.name ?? current!.name, purpose: body?.purpose }));
      args.push(input.name);
      sets.push(`name=$${args.length}`);
      args.push(input.purpose);
      sets.push(`purpose=$${args.length}`);
    }
    // El potrero NO se edita como campo: cambiarlo es una rotación del lote completo (los animales lo
    // siguen y queda historial). Ese cambio pasa por POST /lots/:id/rotate (reusa land.moveLot).
    if (body?.is_active !== undefined) {
      // Archivar por acá es archivar igual: la misma guarda que `DELETE`. Reactivar no necesita
      // ninguna — un lote vacío que vuelve a estar disponible no rompe nada.
      if (!body.is_active) await this.assertLotEmptyToArchive(id);
      args.push(Boolean(body.is_active));
      sets.push(`is_active=$${args.length}`);
    }
    if (sets.length === 0) throw new BadRequestException({ code: 'lot.no_changes', title: 'Nada para actualizar' });
    await this.db.query(`UPDATE lots SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2`, args);
    return this.getLot(id);
  }

  /**
   * Un lote no se archiva con animales adentro.
   *
   * Vive en un método porque había DOS puertas al mismo estado y solo una tenía guarda: `DELETE`
   * contestaba «el lote tiene 21 animales; reasignalos antes de archivarlo», y `PUT {is_active:
   * false}` lo archivaba con los 21 puestos. Y el estado que quedaba era un callejón sin salida: a
   * un lote archivado no se le pueden mover animales (`movement.lot_archived`), así que los que
   * estaban adentro quedaban en un lote que ya no podía recibir a nadie.
   *
   * La regla es la misma para las dos puertas, así que se escribe una vez. Copiarla habría durado
   * hasta que apareciera la tercera.
   */
  private async assertLotEmptyToArchive(id: string) {
    const occ = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals WHERE current_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if ((occ?.n ?? 0) > 0)
      throw new ConflictException({ code: 'lot.occupied', title: `El lote tiene ${occ!.n} animales; reasignalos antes de archivarlo` });
  }

  /** Archiva un lote. Se bloquea si tiene animales activos (reasignarlos primero). */
  async deleteLot(id: string) {
    const t = this.db.tenant;
    const lot = await this.db.one<any>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    await this.assertLotEmptyToArchive(id);
    await this.db.query(`UPDATE lots SET is_active=false, deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, t]);
    return { id, deleted: true };
  }

  /**
   * Historial del lote basado en movimientos REALES (`animal_movements`), agrupado por movimiento
   * (`movement_id`): ingresos, salidas y rotaciones de potrero, con fecha efectiva, origen, destino,
   * motivo, cantidad y usuario. Fuente única de trazabilidad — no se derivan campos manuales.
   */
  async lotHistory(id: string) {
    const t = this.db.tenant;
    const lot = await this.db.one<any>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const rows = await this.db.query<any>(
      `SELECT m.movement_id, max(m.moved_at) AS moved_at, m.from_lot_id, m.to_lot_id, m.from_paddock_id, m.to_paddock_id, m.reason,
              count(*)::int AS animals,
              fl.name AS from_lot, tl.name AS to_lot, fp.name AS from_paddock, tp.name AS to_paddock, COALESCE(u.full_name, u.email) AS actor
       FROM animal_movements m
       LEFT JOIN lots fl ON fl.id=m.from_lot_id
       LEFT JOIN lots tl ON tl.id=m.to_lot_id
       LEFT JOIN paddocks fp ON fp.id=m.from_paddock_id
       LEFT JOIN paddocks tp ON tp.id=m.to_paddock_id
       LEFT JOIN users u ON u.id=m.created_by
       WHERE m.tenant_id=$1 AND m.deleted_at IS NULL AND (m.from_lot_id=$2 OR m.to_lot_id=$2)
       GROUP BY m.movement_id, m.from_lot_id, m.to_lot_id, m.from_paddock_id, m.to_paddock_id, m.reason, fl.name, tl.name, fp.name, tp.name, u.full_name, u.email
       ORDER BY moved_at DESC LIMIT 100`,
      [t, id],
    );
    return rows.map((r) => {
      let kind: 'ingreso' | 'salida' | 'rotacion' | 'movimiento';
      if (r.to_lot_id === id && r.from_lot_id !== id) kind = 'ingreso';
      else if (r.from_lot_id === id && r.to_lot_id !== id) kind = 'salida';
      else if (r.from_paddock_id !== r.to_paddock_id) kind = 'rotacion';
      else kind = 'movimiento';
      return {
        movement_id: r.movement_id,
        moved_at: r.moved_at,
        kind,
        animals: r.animals,
        reason: r.reason,
        actor: r.actor ?? null,
        from_lot: r.from_lot ?? null,
        to_lot: r.to_lot ?? null,
        from_paddock: r.from_paddock ?? null,
        to_paddock: r.to_paddock ?? null,
      };
    });
  }
}
