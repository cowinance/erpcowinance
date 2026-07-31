import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { addFarmDays, computeGrazingMetrics, computePaddockPerformance, summarizeWeather } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../weather/weather.service';
import { LandService } from '../land/land.service';

/** Fechas ISO entre dos días, inclusive. La ventana de un pastoreo son sus días, no sus extremos. */
function rangoDeFechas(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = Date.parse(desde); d <= Date.parse(hasta); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

/**
 * Pastoreo (PG-1): `grazing_records` — un lote entra a un potrero y sale (rotación). Reglas de negocio:
 * un potrero ocupado no admite otra entrada, y un lote no puede pastorear dos potreros a la vez (ambos
 * → 409). Métricas (días, forraje consumido, abierto) DERIVADAS con `computeGrazingMetrics`. Por tenant.
 */
@Injectable()
export class GrazingService {
  constructor(
    private readonly db: DbService,
    private readonly weather: WeatherService,
    private readonly land: LandService,
  ) {}

  async list(paddockId?: string, lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (paddockId) {
      params.push(paddockId);
      filter += ` AND g.paddock_id = $${params.length}`;
    }
    if (lotId) {
      params.push(lotId);
      filter += ` AND g.lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(
      `SELECT g.id, g.paddock_id, p.name AS paddock_name, g.lot_id, l.name AS lot_name, g.entry_date::text AS entry_date, g.exit_date::text AS exit_date,
              g.pre_grazing_kg_dm_ha::float AS pre_grazing_kg_dm_ha, g.post_grazing_kg_dm_ha::float AS post_grazing_kg_dm_ha
       FROM grazing_records g JOIN paddocks p ON p.id = g.paddock_id JOIN lots l ON l.id = g.lot_id
       WHERE g.tenant_id=$1 AND g.deleted_at IS NULL${filter} ORDER BY g.entry_date DESC, g.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => ({ ...r, ...computeGrazingMetrics(r.entry_date, r.exit_date, r.pre_grazing_kg_dm_ha, r.post_grazing_kg_dm_ha) }));
  }

  async get(id: string) {
    const r = await this.db.one<any>(
      `SELECT g.id, g.paddock_id, p.name AS paddock_name, g.lot_id, l.name AS lot_name, g.entry_date::text AS entry_date, g.exit_date::text AS exit_date,
              g.pre_grazing_kg_dm_ha::float AS pre_grazing_kg_dm_ha, g.post_grazing_kg_dm_ha::float AS post_grazing_kg_dm_ha
       FROM grazing_records g JOIN paddocks p ON p.id = g.paddock_id JOIN lots l ON l.id = g.lot_id
       WHERE g.id=$1 AND g.tenant_id=$2 AND g.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!r) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    return { ...r, ...computeGrazingMetrics(r.entry_date, r.exit_date, r.pre_grazing_kg_dm_ha, r.post_grazing_kg_dm_ha) };
  }

  /** Entrada: el lote entra al potrero (nace abierto). Rechaza si el potrero está ocupado o el lote ya pastorea. */
  async enter(body: any) {
    const t = this.db.tenant;
    const paddockId = body?.paddock_id;
    const lotId = body?.lot_id;
    if (!paddockId || !lotId) throw new BadRequestException({ code: 'grazing.missing_fields', title: 'paddock_id y lot_id son obligatorios' });
    await this.requirePaddock(paddockId);
    await this.requireLot(lotId);
    const entryDate = body?.entry_date ?? await this.db.today();

    /*
     * Entrar a pastorear ES mover el lote al potrero, no anotar que entró.
     *
     * Antes esto solo insertaba una fila: el registro decía que el lote estaba en el potrero A
     * mientras `lots.current_paddock_id` decía B, y ninguna de las dos respuestas era desautorizada
     * por la otra. Ahora la entrada delega en la rotación —que mueve el lote, arrastra a sus
     * animales por la regla única de movimientos y abre el pastoreo— y acá solo se le agrega
     * encima lo que Pastoreo sabe y la rotación no: la medición de forraje y, si se está cargando
     * en diferido, la fecha real de entrada.
     *
     * Ya NO se rechaza por potrero ocupado: en esta finca dos lotes pueden compartir potrero. Sí se
     * mantiene que un lote no pastoree dos potreros a la vez — eso no es una política, es que un
     * lote está en un lugar solo.
     */
    const yaEnOtro = await this.db.one<{ id: string }>(
      `SELECT id FROM grazing_records WHERE lot_id=$1 AND tenant_id=$2 AND paddock_id<>$3 AND exit_date IS NULL AND deleted_at IS NULL`,
      [lotId, t, paddockId],
    );
    if (yaEnOtro) throw new ConflictException({ code: 'grazing.lot_already_grazing', title: 'El lote ya está pastoreando otro potrero' });

    // Si el lote YA está en ese potrero no se rota: solo se empieza a registrar el pastoreo. Es el
    // caso normal el día que la finca empieza a usar esta pantalla, con los rodeos ya parados donde
    // están — y rotar habría dado «ya está ahí» sobre algo que el productor no pidió mover.
    const lot = await this.db.one<{ current_paddock_id: string | null }>(
      `SELECT current_paddock_id FROM lots WHERE id=$1 AND tenant_id=$2`,
      [lotId, t],
    );
    if (lot?.current_paddock_id !== paddockId) await this.land.moveLot(paddockId, { lot_id: lotId });

    let abierto = await this.db.one<{ id: string }>(
      `SELECT id FROM grazing_records WHERE tenant_id=$1 AND lot_id=$2 AND paddock_id=$3 AND exit_date IS NULL AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [t, lotId, paddockId],
    );
    if (!abierto)
      abierto = await this.db.one<{ id: string }>(
        `INSERT INTO grazing_records (tenant_id, paddock_id, lot_id, entry_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t, paddockId, lotId, entryDate, this.db.user],
      );
    await this.db.query(
      `UPDATE grazing_records SET entry_date=$2, pre_grazing_kg_dm_ha=$3, updated_at=now() WHERE id=$1 AND tenant_id=$4`,
      [abierto!.id, entryDate, body?.pre_grazing_kg_dm_ha ?? null, t],
    );
    return this.get(abierto!.id);
  }

  /** Salida: cierra el pastoreo (libera el potrero). exit_date ≥ entry_date; solo sobre uno abierto. */
  async exit(id: string, body: any) {
    const t = this.db.tenant;
    const g = await this.db.one<{ id: string; entry_date: string; exit_date: string | null }>(`SELECT id, entry_date::text AS entry_date, exit_date::text AS exit_date FROM grazing_records WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!g) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    if (g.exit_date) throw new ConflictException({ code: 'grazing.already_closed', title: 'El pastoreo ya está cerrado' });
    const exitDate = body?.exit_date ?? await this.db.today();
    if (String(exitDate) < String(g.entry_date)) throw new BadRequestException({ code: 'grazing.invalid_exit', title: 'exit_date no puede ser anterior a entry_date' });
    await this.db.query(`UPDATE grazing_records SET exit_date=$1, post_grazing_kg_dm_ha=$2, updated_at=now() WHERE id=$3 AND tenant_id=$4`, [exitDate, body?.post_grazing_kg_dm_ha ?? null, id, t]);
    return this.get(id);
  }

  /**
   * Ocupación (PG-2): estado actual de cada potrero. Si tiene un pastoreo abierto → ocupado, con el lote
   * y los días transcurridos; si está libre → días de DESCANSO desde la última salida (clave para la
   * recuperación del forraje). Los días los calcula SQL con CURRENT_DATE.
   */
  async occupancy() {
    /*
     * Ocupado es que HAY ANIMALES, no que alguien haya abierto un registro.
     *
     * Antes salía del pastoreo abierto, y por eso podía mentir: se rotaron dos lotes al «Potrero
     * Norte» —31 cabezas— y esta pantalla seguía informando todos los potreros libres. Es la
     * pregunta con la que se decide a dónde mandar el rodeo mañana; contestarla mirando un registro
     * que puede no haberse cargado es contestar otra cosa.
     *
     * Se listan TODOS los lotes presentes porque en esta finca dos lotes pueden compartir potrero
     * (decisión del productor). Mostrar solo el primero escondería justo la carga que importa.
     *
     * El DESCANSO sí sale de `grazing_records`: es el único que sabe cuándo salió el último, y la
     * rotación ahora lo cierra al irse, así que esa fecha es real.
     */
    return this.db.query(
      `SELECT p.id AS paddock_id, p.name AS paddock_name,
              pres.lot_ids, pres.lot_names AS lot_name, pres.head,
              og.entry_date::text AS entry_date,
              CASE WHEN og.entry_date IS NOT NULL THEN (CURRENT_DATE - og.entry_date) END AS days_grazing,
              last.exit_date::text AS last_exit_date,
              CASE WHEN pres.lot_ids IS NULL AND last.exit_date IS NOT NULL THEN (CURRENT_DATE - last.exit_date) END AS days_rest,
              (pres.lot_ids IS NOT NULL) AS occupied
       FROM paddocks p
       LEFT JOIN LATERAL (
         SELECT array_agg(l.id) AS lot_ids, string_agg(l.name, ' + ' ORDER BY l.name) AS lot_names,
                sum((SELECT count(*) FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL))::int AS head
           FROM lots l
          WHERE l.current_paddock_id = p.id AND l.tenant_id = p.tenant_id AND l.deleted_at IS NULL
       ) pres ON true
       LEFT JOIN LATERAL (SELECT min(g.entry_date) AS entry_date FROM grazing_records g
                          WHERE g.paddock_id=p.id AND g.tenant_id=p.tenant_id AND g.exit_date IS NULL AND g.deleted_at IS NULL) og ON true
       LEFT JOIN LATERAL (SELECT max(g.exit_date) AS exit_date FROM grazing_records g
                          WHERE g.paddock_id=p.id AND g.tenant_id=p.tenant_id AND g.deleted_at IS NULL) last ON true
       WHERE p.tenant_id=$1 AND p.deleted_at IS NULL
       ORDER BY (pres.lot_ids IS NOT NULL) DESC, p.name`,
      [this.db.tenant],
    );
  }

  /**
   * Rendimiento del potrero: kilos de carne por hectárea, con el clima de SUS ventanas (Fase 3.2).
   *
   * Cruza tres módulos que hasta acá no se hablaban: Pastoreo sabe quién estuvo y cuánto tiempo,
   * Producción sabe cuántos kilos se ganaron, Clima sabe si llovió. Contesta la pregunta que decide
   * la rotación del año siguiente: **qué potrero produce carne y cuál no** — y, sobre todo, si la
   * culpa fue del potrero o del año.
   *
   * Dos decisiones sostienen que el número no mienta:
   *
   * 1. **La ganancia se mide DENTRO del pastoreo.** No se usa la GDP de `v_weighings`, que compara
   *    contra el pesaje anterior del animal: ese pesaje pudo ser en otro potrero, y usarlo le
   *    atribuiría a éste kilos que el animal engordó en otro lado. Solo cuentan los animales con
   *    al menos dos pesajes entre la entrada y la salida.
   *
   * 2. **El clima es el de las ventanas de ESTE potrero**, no el del período completo. Un potrero
   *    pastoreado en el mes seco y otro en el lluvioso no compiten en igualdad de condiciones, y
   *    promediar el trimestre borraría justamente la diferencia que explica el resultado.
   */
  async performance(params: { from?: string; to?: string } = {}) {
    const t = this.db.tenant;
    const hoy = new Date();
    const to = params.to ?? (await this.db.today());
    const from = params.from ?? addFarmDays(to, -365);

    const ventanas = await this.db.query<any>(
      `WITH cerrados AS (
         SELECT g.id, g.paddock_id, g.lot_id, g.entry_date, g.exit_date
           FROM grazing_records g
          WHERE g.tenant_id = $1 AND g.deleted_at IS NULL AND g.exit_date IS NOT NULL
            AND g.entry_date <= $3::date AND g.exit_date >= $2::date
       ),
       -- Pesajes de la ventana, del lote que estaba pastoreando EN ESE MOMENTO: el lote actual del
       -- animal no sirve, porque para cuando alguien mira el reporte ya lo movieron de rodeo.
       pesajes AS (
         SELECT c.id AS grazing_id, w.animal_id, w.weighed_at, w.weight_kg,
                first_value(w.weight_kg) OVER v AS kg_ini,
                last_value(w.weight_kg) OVER (PARTITION BY c.id, w.animal_id ORDER BY w.weighed_at
                                              ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS kg_fin,
                count(*) OVER (PARTITION BY c.id, w.animal_id) AS n
           FROM cerrados c
           JOIN weighings w ON w.tenant_id = $1 AND w.deleted_at IS NULL
            -- Día de FINCA, no de Greenwich: entry_date y exit_date son fechas calendario de la
            -- finca, así que comparar contra el día UTC mezcla dos calendarios. Un pesaje del
            -- atardecer del último día caía al día siguiente y quedaba FUERA de la ventana, y ése
            -- es el peso de salida: de él sale la ganancia de todo el pastoreo. La sesión ya trae
            -- la zona correcta (applyTenantContext); forzar UTC era pisarla.
            AND w.weighed_at::date BETWEEN c.entry_date AND c.exit_date
           JOIN animals a ON a.id = w.animal_id AND a.tenant_id = $1 AND a.deleted_at IS NULL
          WHERE COALESCE(
                  (SELECT m.to_lot_id FROM animal_movements m
                    WHERE m.animal_id = w.animal_id AND m.tenant_id = $1 AND m.deleted_at IS NULL
                      AND m.moved_at <= w.weighed_at AND m.to_lot_id IS NOT NULL
                    ORDER BY m.moved_at DESC LIMIT 1),
                  a.current_lot_id) = c.lot_id
         WINDOW v AS (PARTITION BY c.id, w.animal_id ORDER BY w.weighed_at)
       ),
       por_animal AS (
         SELECT DISTINCT ON (grazing_id, animal_id) grazing_id, animal_id, (kg_fin - kg_ini)::float AS gain, n
           FROM pesajes ORDER BY grazing_id, animal_id
       ),
       medido AS (
         SELECT grazing_id, count(*)::int AS animals_measured, sum(gain)::float AS gain_kg
           FROM por_animal WHERE n >= 2 GROUP BY grazing_id
       )
       SELECT c.id, c.paddock_id, p.name AS paddock_name, p.area_ha::float AS area_ha, p.pasture_type,
              c.lot_id, l.name AS lot_name, c.entry_date::text AS entry_date, c.exit_date::text AS exit_date,
              (c.exit_date - c.entry_date)::int AS grazing_days,
              COALESCE(m.animals_measured, 0) AS animals_measured, m.gain_kg
         FROM cerrados c
         JOIN paddocks p ON p.id = c.paddock_id
         JOIN lots l ON l.id = c.lot_id
         LEFT JOIN medido m ON m.grazing_id = c.id
        ORDER BY p.name, c.entry_date`,
      [t, from, to],
    );

    // La serie diaria se pide UNA vez para todo el período y se reparte por ventana: pedirla por
    // potrero serían N consultas para leer las mismas filas.
    const serie = await this.weather.daily({ from, to });
    const porFecha = new Map(serie.map((d) => [d.date, d]));

    const potreros = new Map<string, any>();
    for (const v of ventanas) {
      if (!potreros.has(v.paddock_id))
        potreros.set(v.paddock_id, {
          paddock_id: v.paddock_id,
          paddock_name: v.paddock_name,
          area_ha: v.area_ha,
          pasture_type: v.pasture_type,
          grazings: [] as any[],
          dias: new Set<string>(),
        });
      const p = potreros.get(v.paddock_id);
      p.grazings.push(v);
      for (const d of rangoDeFechas(v.entry_date, v.exit_date)) p.dias.add(d);
    }

    const out = [...potreros.values()].map((p) => {
      const dias = [...p.dias].sort();
      const climaDias = dias.map((d) => porFecha.get(d)).filter(Boolean) as any[];
      const clima = summarizeWeather(climaDias, dias[0], dias[dias.length - 1], { expectedDays: dias.length });
      const estres = (clima.heatStressDays?.moderate ?? 0) + (clima.heatStressDays?.severe ?? 0) + (clima.heatStressDays?.emergency ?? 0);
      const rendimiento = computePaddockPerformance({
        areaHa: p.area_ha,
        windows: p.grazings.map((g: any) => ({ grazingDays: g.grazing_days, gainKg: g.gain_kg, animalsMeasured: g.animals_measured })),
        periodDays: dias.length,
        waterBalanceMm: clima.waterBalanceMm,
        rainMm: clima.rainMm,
        heatStressDays: estres,
      });
      return {
        paddock_id: p.paddock_id,
        paddock_name: p.paddock_name,
        area_ha: p.area_ha,
        pasture_type: p.pasture_type,
        grazing_count: p.grazings.length,
        ...rendimiento,
        rain_mm: clima.rainMm,
        water_balance_mm: clima.waterBalanceMm,
        heat_stress_days: estres,
        /** Días de las ventanas sin ninguna medición del clima: la confianza viaja con el número. */
        days_without_weather: clima.daysWithoutData,
        grazings: p.grazings.map((g: any) => ({
          lot_name: g.lot_name,
          entry_date: g.entry_date,
          exit_date: g.exit_date,
          grazing_days: g.grazing_days,
          animals_measured: g.animals_measured,
          gain_kg: g.gain_kg,
        })),
      };
    });

    // El mejor arriba. Los que no se pudieron medir van al final: no son los peores, son los que
    // nadie pesó, y mezclarlos con los malos sería la conclusión equivocada.
    out.sort((a, b) => (b.gainKgPerHaPerDay ?? -Infinity) - (a.gainKgPerHaPerDay ?? -Infinity));
    return { from, to, paddocks: out };
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE grazing_records SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    return { id, deleted: true };
  }

  private async requirePaddock(id: string) {
    const p = await this.db.one<{ id: string }>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'grazing.paddock_not_found', title: 'Potrero no encontrado' });
  }

  private async requireLot(id: string) {
    const l = await this.db.one<{ id: string }>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!l) throw new NotFoundException({ code: 'grazing.lot_not_found', title: 'Lote no encontrado' });
  }
}
