import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidLotError, computeFeedlotMetrics, validateLotInput } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { signFileToken } from '../../common/file-token';
import { AnimalWriteService } from './animal-write.service';
import { BillingService } from '../billing/billing.service';

/** Referencia de foto (id + token firmado) para renderizar desde el navegador. */
function photoRef(db: DbService, fileId?: string | null, mime?: string | null) {
  if (!fileId) return null;
  return { file_id: fileId, mime: mime ?? 'image/jpeg', token: signFileToken(fileId, db.tenant, mime ?? 'image/jpeg') };
}

export interface ListAnimalsParams {
  status?: string;
  category?: string;
  lot?: string;
  q?: string;
  sex?: string;
  minWeight?: number;
  maxWeight?: number;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class HerdService {
  constructor(
    private readonly db: DbService,
    private readonly writer: AnimalWriteService,
    private readonly billing: BillingService,
  ) {}

  async listAnimals(params: ListAnimalsParams) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const where: string[] = ['a.tenant_id = $1', 'a.deleted_at IS NULL'];
    const args: unknown[] = [this.db.tenant];

    if (params.status) {
      args.push(params.status);
      where.push(`a.status = $${args.length}`);
    }
    if (params.category) {
      args.push(params.category);
      where.push(`c.code = $${args.length}`);
    }
    if (params.lot) {
      args.push(params.lot);
      where.push(`a.current_lot_id = $${args.length}`);
    }
    if (params.q) {
      args.push(`%${params.q}%`);
      where.push(`(t.value ILIKE $${args.length} OR a.name ILIKE $${args.length})`);
    }
    if (params.sex) {
      args.push(params.sex);
      where.push(`a.sex = $${args.length}`);
    }
    // Peso: sobre la última pesada (v_weighings). Sin pesada → excluido del rango.
    if (params.minWeight != null) {
      args.push(params.minWeight);
      where.push(`w.weight_kg >= $${args.length}`);
    }
    if (params.maxWeight != null) {
      args.push(params.maxWeight);
      where.push(`w.weight_kg <= $${args.length}`);
    }
    // Edad en meses (desde birth_date). Sin fecha → excluido del rango.
    if (params.minAgeMonths != null) {
      args.push(params.minAgeMonths);
      where.push(`a.birth_date IS NOT NULL AND a.birth_date <= CURRENT_DATE - ($${args.length}::int * INTERVAL '1 month')`);
    }
    if (params.maxAgeMonths != null) {
      args.push(params.maxAgeMonths);
      where.push(`a.birth_date IS NOT NULL AND a.birth_date >= CURRENT_DATE - ($${args.length}::int * INTERVAL '1 month')`);
    }
    if (params.cursor) {
      try {
        const { created_at, id } = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
        args.push(created_at, id);
        where.push(`(a.created_at, a.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`);
      } catch {
        throw new BadRequestException({ code: 'pagination.invalid_cursor', title: 'Cursor inválido' });
      }
    }

    args.push(limit + 1);
    const rows = await this.db.query<any>(
      `SELECT a.id, a.name, a.sex, a.status, a.birth_date, a.created_at,
              c.name AS category, c.code AS category_code,
              l.name AS lot_name, a.current_lot_id AS lot_id,
              p.name AS paddock_name,
              t.value AS tag,
              w.weight_kg::float AS last_weight_kg, w.adg_since_last::float AS adg, w.weighed_at AS last_weighed_at,
              br.breeds,
              a.photo_file_id, pf.mime_type AS photo_mime
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN paddocks p ON p.id = a.current_paddock_id
       LEFT JOIN files pf ON pf.id = a.photo_file_id AND pf.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers ai
         WHERE ai.animal_id = a.id AND ai.type = 'visual' AND ai.deleted_at IS NULL
         ORDER BY ai.created_at DESC LIMIT 1) t ON true
       LEFT JOIN LATERAL (
         SELECT weight_kg, adg_since_last, weighed_at FROM v_weighings w
         WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY w.weighed_at DESC, w.created_at DESC, w.id DESC LIMIT 1) w ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(b.name, ' × ') AS breeds
         FROM animal_breeds ab JOIN breeds b ON b.id = ab.breed_id
         WHERE ab.animal_id = a.id AND ab.deleted_at IS NULL) br ON true
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${args.length}`,
      args,
    );

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...r,
      photo: photoRef(this.db, r.photo_file_id, r.photo_mime),
    }));
    const last = data[data.length - 1];
    return {
      data,
      next_cursor: hasMore
        ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64url')
        : null,
    };
  }

  async getAnimal(id: string) {
    const animal = await this.db.one<any>(
      `SELECT a.*, c.name AS category, c.code AS category_code, s.name AS species,
              l.name AS lot_name, p.name AS paddock_name, f.name AS farm_name,
              pf.mime_type AS photo_mime
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN species s ON s.id = a.species_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN paddocks p ON p.id = a.current_paddock_id
       LEFT JOIN farms f ON f.id = a.farm_id
       LEFT JOIN files pf ON pf.id = a.photo_file_id AND pf.deleted_at IS NULL
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });

    const [identifiers, breeds, lastWeighing, weighings, pregnancy, withdrawal, eventCount] = await Promise.all([
      this.db.query(
        `SELECT type, value, is_official FROM animal_identifiers WHERE animal_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
        [id],
      ),
      this.db.query(
        `SELECT b.name, ab.fraction::float FROM animal_breeds ab JOIN breeds b ON b.id = ab.breed_id WHERE ab.animal_id = $1`,
        [id],
      ),
      this.db.one<any>(
        `SELECT weight_kg::float, adg_since_last::float AS adg, body_condition::float, weighed_at
         FROM v_weighings WHERE animal_id = $1 AND deleted_at IS NULL ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1`,
        [id],
      ),
      this.db.query(
        `SELECT weight_kg::float, weighed_at FROM weighings WHERE animal_id = $1 AND deleted_at IS NULL ORDER BY weighed_at`,
        [id],
      ),
      this.db.one<any>(
        `SELECT diagnosis_date, expected_due_date, method FROM pregnancies
         WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL ORDER BY diagnosis_date DESC LIMIT 1`,
        [id],
      ),
      this.db.one<any>(
        `SELECT max(meat_withdrawal_until) AS meat_until, max(milk_withdrawal_until) AS milk_until
         FROM treatments WHERE animal_id = $1 AND deleted_at IS NULL
           AND (meat_withdrawal_until >= CURRENT_DATE OR milk_withdrawal_until >= now())`,
        [id],
      ),
      this.db.one<any>(`SELECT count(*)::int AS n FROM animal_events WHERE animal_id = $1`, [id]),
    ]);

    const genealogy = await this.db.one<any>(
      `SELECT dam.id AS dam_id, dtag.value AS dam_tag, sire.id AS sire_id, stag.value AS sire_tag
       FROM animals a
       LEFT JOIN animals dam ON dam.id = a.dam_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = dam.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) dtag ON true
       LEFT JOIN animals sire ON sire.id = a.sire_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = sire.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) stag ON true
       WHERE a.id = $1`,
      [id],
    );
    const offspring = await this.db.query<any>(
      `SELECT a.id, ai.value AS tag, a.sex, a.birth_date, a.status
       FROM animals a
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE (a.dam_id = $1 OR a.sire_id = $1) AND a.deleted_at IS NULL ORDER BY a.birth_date DESC LIMIT 20`,
      [id],
    );

    return {
      ...animal,
      photo: photoRef(this.db, animal.photo_file_id, animal.photo_mime),
      identifiers,
      breeds,
      last_weighing: lastWeighing ?? null,
      weight_series: weighings,
      open_pregnancy: pregnancy ?? null,
      active_withdrawal: withdrawal?.meat_until || withdrawal?.milk_until ? withdrawal : null,
      event_count: eventCount?.n ?? 0,
      genealogy: genealogy ?? null,
      offspring,
    };
  }

  /** Resolver animal por caravana/RFID (confirmación de escaneo en manga). */
  async lookup(body: { identifier?: string }) {
    if (!body?.identifier)
      throw new BadRequestException({ code: 'lookup.missing_identifier', title: 'identifier es obligatorio' });
    const row = await this.db.one<any>(
      `SELECT a.id, a.name, a.sex, a.status, c.name AS category, ai.value AS tag,
              w.weight_kg::float AS last_weight_kg, w.weighed_at AS last_weighed_at
       FROM animal_identifiers i
       JOIN animals a ON a.id = i.animal_id AND a.deleted_at IS NULL
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN LATERAL (
         SELECT weight_kg, weighed_at FROM v_weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) w ON true
       WHERE i.tenant_id = $1 AND i.value = $2 AND i.deleted_at IS NULL
       ORDER BY (a.status = 'active') DESC, i.created_at DESC LIMIT 1`,
      [this.db.tenant, body.identifier.trim()],
    );
    if (!row)
      throw new NotFoundException({ code: 'animal.not_found', title: `Sin animal con identificador ${body.identifier}` });
    return row;
  }

  async timeline(id: string) {
    await this.assertAnimal(id);
    return this.db.query(
      `SELECT e.id,
              e.event_type,
              CASE
                WHEN e.event_type = 'weighing' THEN e.payload || jsonb_build_object('adg_since_last', w.adg_since_last)
                ELSE e.payload
              END AS payload,
              e.occurred_at,
              e.recorded_at,
              e.source
       FROM animal_events e
       LEFT JOIN LATERAL (
         SELECT adg_since_last
         FROM v_weighings w
         WHERE w.animal_id = e.animal_id AND w.weighed_at = e.occurred_at
         ORDER BY w.created_at, w.id
         LIMIT 1
       ) w ON e.event_type = 'weighing'
       WHERE e.animal_id = $1 AND e.tenant_id = $2
       ORDER BY e.occurred_at DESC LIMIT 300`,
      [id, this.db.tenant],
    );
  }

  /**
   * Alta manual REST — adaptador delgado sobre la persistencia neutral
   * (`AnimalWriteService`, D1). La regla y la escritura son únicas y compartidas
   * con el futuro canal de importación; este adaptador solo aporta la semántica
   * del canal REST (evento `birth`, fuente `manual`, `sync='none'`) y traduce el
   * resultado a las respuestas HTTP de siempre.
   */
  async createAnimal(body: {
    tag: string;
    sex: 'F' | 'M';
    category_code: string;
    name?: string;
    birth_date?: string;
    lot_id?: string;
  }) {
    await this.billing.assertWithinLimit('animals'); // B-2: límite del plan (create REST; el import se difiere)
    const nv = this.writer.normalizeAndValidate(body);
    if (!nv.ok) {
      // Contrato REST preservado: cualquier campo obligatorio ausente → animal.missing_fields.
      if (nv.errors.some((e) => e.code === 'required'))
        throw new BadRequestException({ code: 'animal.missing_fields', title: 'tag, sex y category_code son obligatorios' });
      const first = nv.errors[0];
      throw new BadRequestException({ code: `animal.invalid_${first.field}`, title: first.message });
    }

    return this.db.tx(async (q) => {
      const check = await this.writer.checkAgainstDb(q, nv.input);
      if ('skip' in check)
        throw new BadRequestException({
          code: 'animal.duplicate_tag',
          title: `Ya existe un animal activo con caravana ${nv.input.tag}`,
        });
      if (!check.ok) throw new BadRequestException({ code: 'animal.invalid_category', title: 'Categoría inexistente' });

      const { animalId, syncOp } = await this.writer.persistNewAnimal(
        q,
        nv.input,
        { origin: 'rest', actorUserId: this.db.user, timeline: { eventType: 'birth', source: 'manual' }, sync: 'server_origin' },
        check.resolved,
      );
      // Propagación incremental a dispositivos (ADR-0016): el alta web se emite como
      // changeset de origen servidor. Cierra la brecha de que las altas web no
      // llegaban por pull a devices ya bootstrapeados.
      if (syncOp) await this.writer.emitServerOrigin(q, [syncOp], `rest:animal:${animalId}`);
      return this.getAnimal(animalId);
    });
  }

  /** Evento polimórfico (POST /animals/:id/events) — como en el doc de APIs. */
  async registerEvent(id: string, body: any) {
    await this.assertAnimal(id);
    const occurredAt = body.occurred_at ?? new Date().toISOString();

    if (body.type === 'weighing') {
      const kg = Number(body.weight_kg);
      if (!kg || kg <= 0)
        throw new BadRequestException({ code: 'weighing.invalid_weight', title: 'weight_kg debe ser positivo' });
      const inserted = await this.db.one<{ id: string }>(
        `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, body_condition)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [this.db.tenant, id, occurredAt, kg, body.method ?? 'scale', body.body_condition ?? null],
      );
      const derived = await this.db.one<{ adg_since_last: number | null }>(
        `SELECT adg_since_last::float FROM v_weighings WHERE id = $1`,
        [inserted?.id],
      );
      const ev = await this.insertEvent(id, 'weighing', { weight_kg: kg }, occurredAt);
      return { ...ev, adg_since_last: derived?.adg_since_last ?? null };
    }

    if (body.type === 'note') {
      return this.insertEvent(id, 'note', { text: body.text ?? '' }, occurredAt);
    }

    throw new BadRequestException({ code: 'event.unsupported_type', title: `Tipo de evento no soportado aún: ${body.type}` });
  }

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

  async lots() {
    const rows = await this.db.query<any>(
      `SELECT l.id, l.name, l.purpose, l.is_active, l.current_paddock_id, p.name AS paddock_name,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS animal_count,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL
                 AND NOT EXISTS(SELECT 1 FROM animal_identifiers ai WHERE ai.animal_id=a.id AND ai.type='visual' AND ai.deleted_at IS NULL)) AS sin_id,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL
                 AND NOT EXISTS(SELECT 1 FROM v_weighings w WHERE w.animal_id=a.id AND w.deleted_at IS NULL AND w.weighed_at >= CURRENT_DATE - 90)) AS sin_pesaje,
              (SELECT count(DISTINCT a.category_id)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS categorias
       FROM lots l LEFT JOIN paddocks p ON p.id = l.current_paddock_id
       WHERE l.tenant_id = $1 AND l.deleted_at IS NULL ORDER BY l.is_active DESC, l.name`,
      [this.db.tenant],
    );
    return rows.map((l) => {
      const { status, alerts } = this.computeLotAlerts({ isActive: l.is_active, head: l.animal_count, paddockId: l.current_paddock_id, sinId: l.sin_id, sinPesaje: l.sin_pesaje, categorias: l.categorias });
      return { id: l.id, name: l.name, purpose: l.purpose, is_active: l.is_active, paddock_name: l.paddock_name, animal_count: l.animal_count, status, alert_count: alerts.length };
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
                count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM v_weighings w WHERE w.animal_id=a.id AND w.deleted_at IS NULL AND w.weighed_at >= CURRENT_DATE - 90))::int AS sin_pesaje,
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
      args.push(Boolean(body.is_active));
      sets.push(`is_active=$${args.length}`);
    }
    if (sets.length === 0) throw new BadRequestException({ code: 'lot.no_changes', title: 'Nada para actualizar' });
    await this.db.query(`UPDATE lots SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2`, args);
    return this.getLot(id);
  }

  /** Archiva un lote. Se bloquea si tiene animales activos (reasignarlos primero). */
  async deleteLot(id: string) {
    const t = this.db.tenant;
    const lot = await this.db.one<any>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    const occ = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals WHERE current_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`,
      [id, t],
    );
    if ((occ?.n ?? 0) > 0) throw new ConflictException({ code: 'lot.occupied', title: `El lote tiene ${occ!.n} animales; reasignalos antes de archivarlo` });
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

  async categories() {
    return this.db.query(
      `SELECT c.code, c.name, (SELECT count(*)::int FROM animals a WHERE a.category_id = c.id AND a.status='active' AND a.deleted_at IS NULL) AS animal_count
       FROM animal_categories c ORDER BY c.name`,
    );
  }

  private async insertEvent(animalId: string, type: string, payload: Record<string, unknown>, occurredAt: string) {
    const row = await this.db.one<any>(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,now(),'manual') RETURNING id, event_type, occurred_at, recorded_at`,
      [this.db.tenant, animalId, type, JSON.stringify(payload), occurredAt],
    );
    return row;
  }

  private async assertAnimal(id: string) {
    const found = await this.db.one(`SELECT id FROM animals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [
      id,
      this.db.tenant,
    ]);
    if (!found) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
  }
}
