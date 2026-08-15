import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  parentageChronologyIssue, InvalidLotError, Sex, TagNumber, computeFeedlotMetrics, validateLotInput, validateWeighing } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { signFileToken } from '../../common/file-token';
import { AnimalWriteService } from './animal-write.service';
import { BillingService } from '../billing/billing.service';
import { assertAnimal } from './assert-animal';

/** Referencia de foto (id + token firmado) para renderizar desde el navegador. */
function photoRef(db: DbService, fileId?: string | null, mime?: string | null) {
  if (!fileId) return null;
  return { file_id: fileId, mime: mime ?? 'image/jpeg', token: signFileToken(fileId, db.tenant, mime ?? 'image/jpeg') };
}

export interface ListAnimalsParams {
  status?: string;
  category?: string;
  lot?: string;
  paddock?: string;
  breed?: string;
  origin?: string;
  q?: string;
  sex?: string;
  minWeight?: number;
  maxWeight?: number;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  withLot?: boolean;
  withPhoto?: boolean;
  withOfficialId?: boolean;
  withdrawal?: boolean;
  openCase?: boolean;
  pregnant?: boolean;
  noRecentWeighingDays?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

/**
 * Expresiones de orden del listado (Animales E1). Cada clave es un criterio
 * público; `expr` es la columna/valor SQL y `kind` decide el sentinel de COALESCE
 * para que los NULL queden SIEMPRE al final del orden (keyset sin ramas de null).
 * Así la paginación por cursor `(sortval, id)` funciona para cualquier orden.
 */
const ANIMAL_SORTS: Record<string, { expr: string; kind: 'num' | 'text' | 'date' }> = {
  tag: { expr: 't.value', kind: 'text' },
  created: { expr: 'a.created_at', kind: 'date' },
  age: { expr: 'a.birth_date', kind: 'date' },
  weight: { expr: 'w.weight_kg', kind: 'num' },
  gdp: { expr: 'w.adg_since_last', kind: 'num' },
  lot: { expr: 'l.name', kind: 'text' },
  category: { expr: 'c.name', kind: 'text' },
  status: { expr: 'a.status', kind: 'text' },
};

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
    if (params.paddock) {
      args.push(params.paddock);
      where.push(`a.current_paddock_id = $${args.length}`);
    }
    if (params.origin) {
      args.push(params.origin);
      where.push(`a.origin = $${args.length}`);
    }
    if (params.breed) {
      args.push(params.breed);
      where.push(
        `EXISTS (SELECT 1 FROM animal_breeds ab WHERE ab.animal_id = a.id AND ab.deleted_at IS NULL AND ab.breed_id = $${args.length})`,
      );
    }
    // Búsqueda: cualquier identificador (visual/RFID/oficial/tatuaje/bolo/marca) o nombre.
    if (params.q) {
      args.push(`%${params.q}%`);
      where.push(
        // `retired_at IS NULL`: la búsqueda mira los identificadores VIGENTES, no los que el animal
        // tuvo alguna vez.
        //
        // Recaravanear es normal —se saca la caravana de un animal y se le pone a otro— y sin este
        // filtro, buscar ese número devolvía DOS animales: el que la tiene y el que la tuvo. El
        // segundo aparecía con su caravana actual, así que no había forma de saber por qué había
        // salido en esa búsqueda. Comprobado contra la app.
        //
        // El resto del sistema ya lo hacía bien: el lookup del modo manga —donde una caravana tiene
        // que devolver UN animal— filtra los retirados desde siempre. Era el buscador el que estaba
        // solo.
        `(a.name ILIKE $${args.length} OR EXISTS (SELECT 1 FROM animal_identifiers qi WHERE qi.animal_id = a.id AND qi.deleted_at IS NULL AND qi.retired_at IS NULL AND qi.value ILIKE $${args.length}))`,
      );
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
    // Presencia/ausencia (calidad de datos): lote, foto, identificador oficial.
    if (params.withLot != null) where.push(`a.current_lot_id IS ${params.withLot ? 'NOT NULL' : 'NULL'}`);
    if (params.withPhoto != null) where.push(`a.photo_file_id IS ${params.withPhoto ? 'NOT NULL' : 'NULL'}`);
    if (params.withOfficialId != null)
      where.push(
        `${params.withOfficialId ? '' : 'NOT '}EXISTS (SELECT 1 FROM animal_identifiers oi WHERE oi.animal_id = a.id AND oi.deleted_at IS NULL AND oi.is_official = true)`,
      );
    // Retiro sanitario activo (carne/leche vigente) — reusa treatments.
    if (params.withdrawal)
      where.push(
        `EXISTS (SELECT 1 FROM treatments tr WHERE tr.animal_id = a.id AND tr.deleted_at IS NULL AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now()))`,
      );
    // Caso clínico abierto (open/in_treatment/observation) — reusa clinical_cases.
    if (params.openCase)
      where.push(
        `EXISTS (SELECT 1 FROM clinical_cases cc WHERE cc.animal_id = a.id AND cc.deleted_at IS NULL AND cc.status IN ('open','in_treatment','observation'))`,
      );
    // Preñez abierta — reusa pregnancies.
    if (params.pregnant)
      where.push(
        `EXISTS (SELECT 1 FROM pregnancies pg WHERE pg.animal_id = a.id AND pg.status = 'open' AND pg.deleted_at IS NULL)`,
      );
    // Sin pesaje reciente: última pesada más vieja que N días, o nunca pesado.
    if (params.noRecentWeighingDays != null) {
      args.push(params.noRecentWeighingDays);
      where.push(`(w.weighed_at IS NULL OR w.weighed_at < now() - ($${args.length}::int * INTERVAL '1 day'))`);
    }

    // Orden configurable + keyset. COALESCE con sentinel según dirección → NULLs al final.
    const sort = ANIMAL_SORTS[params.sort ?? 'created'] ?? ANIMAL_SORTS.created;
    const dir = params.dir === 'asc' || params.dir === 'desc'
      ? params.dir
      : params.sort === 'tag' || params.sort === 'lot' || params.sort === 'category' || params.sort === 'status'
        ? 'asc'
        : 'desc';
    const sentinel =
      sort.kind === 'num'
        ? dir === 'desc' ? 'COALESCE(' + sort.expr + '::float, -1e15)' : 'COALESCE(' + sort.expr + '::float, 1e15)'
        : sort.kind === 'date'
          ? dir === 'desc'
            ? "COALESCE(" + sort.expr + "::timestamptz, '0001-01-01T00:00:00Z'::timestamptz)"
            : "COALESCE(" + sort.expr + "::timestamptz, '9999-12-31T00:00:00Z'::timestamptz)"
          : dir === 'desc' ? "COALESCE(" + sort.expr + ", '')" : "COALESCE(" + sort.expr + ", '~~~~~~~~~~~~~~~~')";
    const cmp = dir === 'desc' ? '<' : '>';
    const cast = sort.kind === 'num' ? '::float' : sort.kind === 'date' ? '::timestamptz' : '::text';

    if (params.cursor) {
      try {
        const { v, id } = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
        args.push(v, id);
        where.push(`(${sentinel}, a.id) ${cmp} ($${args.length - 1}${cast}, $${args.length}::uuid)`);
      } catch {
        throw new BadRequestException({ code: 'pagination.invalid_cursor', title: 'Cursor inválido' });
      }
    }

    args.push(limit + 1);
    const rows = await this.db.query<any>(
      `SELECT a.id, a.name, a.sex, a.status, a.birth_date, a.created_at, a.origin,
              c.name AS category, c.code AS category_code,
              l.name AS lot_name, a.current_lot_id AS lot_id,
              p.name AS paddock_name, a.current_paddock_id AS paddock_id,
              t.value AS tag,
              w.weight_kg::float AS last_weight_kg, w.adg_since_last::float AS adg, w.weighed_at AS last_weighed_at,
              br.breeds,
              a.photo_file_id, pf.mime_type AS photo_mime,
              ${sentinel} AS _sortval
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN paddocks p ON p.id = a.current_paddock_id
       LEFT JOIN files pf ON pf.id = a.photo_file_id AND pf.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers ai
         WHERE ai.animal_id = a.id AND ai.type = 'visual' AND ai.deleted_at IS NULL AND ai.retired_at IS NULL
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
       ORDER BY _sortval ${dir}, a.id ${dir}
       LIMIT $${args.length}`,
      args,
    );

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map(({ _sortval, ...r }) => ({
      ...r,
      photo: photoRef(this.db, r.photo_file_id, r.photo_mime),
    }));
    const lastRaw = (hasMore ? rows.slice(0, limit) : rows).at(-1);
    return {
      data,
      next_cursor: hasMore
        ? Buffer.from(JSON.stringify({ v: lastRaw._sortval, id: lastRaw.id })).toString('base64url')
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
        `SELECT id, type, value, is_official, issued_at, retired_at, (retired_at IS NULL) AS active
         FROM animal_identifiers WHERE animal_id = $1 AND deleted_at IS NULL
         ORDER BY (retired_at IS NULL) DESC, is_official DESC, created_at`,
        [id],
      ),
      this.db.query(
        `SELECT b.id AS breed_id, b.name, ab.fraction::float FROM animal_breeds ab JOIN breeds b ON b.id = ab.breed_id WHERE ab.animal_id = $1`,
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
      this.db.one<any>(`SELECT count(*)::int AS n FROM animal_events WHERE animal_id = $1 AND deleted_at IS NULL`, [id]),
    ]);

    const genealogy = await this.db.one<any>(
      // La receptora viaja al lado de los padres: en una transferencia, quién gestó al animal es
      // parte de su historia y hay que poder rastrearlo con el animal adelante. No es un progenitor
      // —no aportó genes— y por eso va en su propio campo, no mezclada con la madre.
      `SELECT dam.id AS dam_id, dtag.value AS dam_tag, sire.id AS sire_id, stag.value AS sire_tag,
              rec.id AS recipient_dam_id, rtag.value AS recipient_tag, a.breeding_method_origin
       FROM animals a
       LEFT JOIN animals dam ON dam.id = a.dam_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = dam.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) dtag ON true
       LEFT JOIN animals sire ON sire.id = a.sire_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = sire.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) stag ON true
       LEFT JOIN animals rec ON rec.id = a.recipient_dam_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = rec.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) rtag ON true
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

  /**
   * Resolver animal por caravana/RFID/oficial (confirmación de escaneo en manga, A-Manga E1).
   * Devuelve la TARJETA ROBUSTA en UNA query: identidad + ubicación + último peso/CC/GDP +
   * días desde pesaje + preñez/parto probable + retiro activo + caso clínico abierto. Datos que
   * la UI necesita para mostrar contexto y derivar alertas rápidas sin llamadas extra. Lecturas
   * directas de tablas reales (mismas fuentes que animalOverview), sin reimplementar reglas.
   */
  async lookup(body: { identifier?: string }) {
    if (!body?.identifier)
      throw new BadRequestException({ code: 'lookup.missing_identifier', title: 'identifier es obligatorio' });
    const row = await this.db.one<any>(
      `SELECT a.id, a.name, a.sex, a.status, a.birth_date, a.current_lot_id AS lot_id,
              c.name AS category, c.code AS category_code, c.min_age_months, c.max_age_months, c.sex AS category_sex,
              l.name AS lot_name, p.name AS paddock_name,
              ai.value AS tag,
              w.weight_kg::float AS last_weight_kg, w.weighed_at AS last_weighed_at,
              w.adg_since_last::float AS adg, w.body_condition::float AS last_body_condition,
              CASE WHEN w.weighed_at IS NOT NULL THEN (CURRENT_DATE - w.weighed_at::date) END AS days_since_weighing,
              preg.expected_due_date::text AS expected_due_date,
              (wd.meat_until IS NOT NULL OR wd.milk_until IS NOT NULL) AS has_withdrawal,
              wd.meat_until::text AS meat_withdrawal_until,
              -- La fecha de LECHE se calculaba acá arriba y se tiraba: la tarjeta decía «tiene
              -- retiro» y solo mostraba la de carne. En un tambo eso es grave — una vaca en retiro
              -- de leche que va al ordeñe contamina el TANQUE ENTERO, no su tacho. El móvil ya la
              -- tenía; la web se quedaba sin ella.
              wd.milk_until::text AS milk_withdrawal_until,
              cc.open_cases::int AS open_cases, cc.max_severity AS case_severity
       FROM animal_identifiers i
       JOIN animals a ON a.id = i.animal_id AND a.deleted_at IS NULL
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN paddocks p ON p.id = a.current_paddock_id
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN LATERAL (
         SELECT weight_kg, weighed_at, adg_since_last, body_condition FROM v_weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) w ON true
       LEFT JOIN LATERAL (
         SELECT expected_due_date FROM pregnancies WHERE animal_id = a.id AND status='open' AND deleted_at IS NULL
         ORDER BY diagnosis_date DESC LIMIT 1) preg ON true
       LEFT JOIN LATERAL (
         SELECT max(meat_withdrawal_until) AS meat_until, max(milk_withdrawal_until) AS milk_until
         FROM treatments WHERE animal_id = a.id AND deleted_at IS NULL
           AND (meat_withdrawal_until >= CURRENT_DATE OR milk_withdrawal_until >= now())) wd ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS open_cases, max(severity) AS max_severity
         FROM clinical_cases WHERE animal_id = a.id AND deleted_at IS NULL AND status IN ('open','in_treatment','observation')) cc ON true
       WHERE i.tenant_id = $1 AND i.value = $2 AND i.deleted_at IS NULL AND i.retired_at IS NULL
       ORDER BY (a.status = 'active') DESC, i.created_at DESC LIMIT 1`,
      [this.db.tenant, body.identifier.trim()],
    );
    if (!row)
      throw new NotFoundException({ code: 'animal.not_found', title: `Sin animal con identificador ${body.identifier}` });
    return row;
  }

  async timeline(id: string) {
    await assertAnimal(this.db, id);
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
       WHERE e.animal_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
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
    // Alta mejorada (A360 E4): campos opcionales adicionales.
    origin?: 'born' | 'purchased' | 'transferred';
    birth_date_estimated?: boolean;
    acquisition_date?: string;
    coat_color?: string;
    notes?: string;
    rfid?: string;
    official_id?: string;
    dam_id?: string;
    sire_id?: string;
    breeds?: { breed_id: string; fraction?: number }[];
  }) {
    await this.billing.assertWithinLimit('animals'); // B-2: límite del plan (create REST; el import se difiere)
    const nv = this.writer.normalizeAndValidate(body, await this.db.today());
    if (!nv.ok) {
      // Contrato REST preservado: cualquier campo obligatorio ausente → animal.missing_fields.
      if (nv.errors.some((e) => e.code === 'required'))
        throw new BadRequestException({ code: 'animal.missing_fields', title: 'tag, sex y category_code son obligatorios' });
      const first = nv.errors[0];
      throw new BadRequestException({ code: `animal.invalid_${first.field}`, title: first.message });
    }

    const t = this.db.tenant;
    // Evento de alta según el origen: nacimiento / compra / transferencia.
    const eventType = nv.input.origin === 'purchased' ? 'purchase' : nv.input.origin === 'transferred' ? 'transfer' : 'birth';

    let newId = '';
    await this.db.tx(async (q) => {
      const check = await this.writer.checkAgainstDb(q, nv.input);
      if ('skip' in check)
        throw new BadRequestException({
          code: 'animal.duplicate_tag',
          title: `Ya existe un animal activo con caravana ${nv.input.tag}`,
        });
      if (!check.ok) {
        // `checkAgainstDb` valida categoría Y (Fase 3c) raza/lote por nombre + duplicados de
        // RFID/ID oficial — para AMBOS canales. Se traduce el error real, no uno hardcodeado.
        const e = check.errors[0];
        throw new BadRequestException({
          code: e.code === 'duplicate' ? 'identifier.duplicate' : `animal.invalid_${e.field}`,
          title: e.message,
        });
      }

      const { animalId, syncOp } = await this.writer.persistNewAnimal(
        q,
        nv.input,
        { origin: 'rest', actorUserId: this.db.user, timeline: { eventType, source: 'manual' }, sync: 'server_origin' },
        check.resolved,
      );
      newId = animalId;
      // Propagación incremental a dispositivos (ADR-0016): el alta web se emite como
      // changeset de origen servidor.
      if (syncOp) await this.writer.emitServerOrigin(q, [syncOp], `rest:animal:${animalId}`);

      // ── Campos adicionales del alta mejorada ──
      const setCols: string[] = [];
      const setArgs: unknown[] = [];
      const syncExtra: Record<string, unknown> = {};
      const col = (name: string, val: unknown) => { setArgs.push(val); setCols.push(`${name} = $${setArgs.length}`); };
      if (body.birth_date_estimated != null) col('birth_date_estimated', !!body.birth_date_estimated);
      if (body.acquisition_date) col('acquisition_date', body.acquisition_date);
      if (body.coat_color) { col('coat_color', body.coat_color); syncExtra.coat_color = body.coat_color; }
      if (body.notes) { col('notes', body.notes); syncExtra.notes = body.notes; }

      // Genealogía. Un animal recién nacido no puede formar un ciclo, así que `requireParent`
      // alcanza: existencia, sexo y cronología. El nombre del campo ES el de la columna.
      for (const field of ['dam_id', 'sire_id'] as const) {
        const v = body[field];
        if (!v) continue;
        await this.writer.requireParent(q, v, field, body.birth_date ?? null);
        col(field, v);
        syncExtra[field] = v;
      }

      if (setCols.length) {
        setArgs.push(newId, t);
        await q.query(`UPDATE animals SET ${setCols.join(', ')}, updated_at = now() WHERE id = $${setArgs.length - 1} AND tenant_id = $${setArgs.length}`, setArgs);
      }
      // Los campos syncables extra se proyectan como segundo changeset (LWW) para que
      // los devices offline reciban color/notas/genealogía del alta.
      const op = await this.writer.projectAnimalUpdate(q, newId, syncExtra);
      if (op) await this.writer.emitServerOrigin(q, [op], `rest:animal:create-extra:${newId}:${op.hlc}`);

      // RFID / ID oficial los escribe `persistNewAnimal` (regla única compartida con importación);
      // sus duplicados ya los rechazó `checkAgainstDb` arriba. Antes se insertaban acá también.

      if (body.breeds?.length) await this.setBreedsInTx(q, newId, body.breeds);
    });

    // getAnimal fuera de la tx (evita bloquear la conexión única de PGlite).
    return this.getAnimal(newId);
  }

  /**
   * Vista 360 del animal (A360 E3) — COMPONE en una llamada las secciones de sanidad,
   * movimientos y producción para la ficha. Son LECTURAS directas de las tablas reales
   * (treatments/vaccinations/clinical_cases/animal_movements/calvings/milk_production_daily),
   * no reimplementa reglas de negocio. El estado reproductivo (regla única computeReproStatus)
   * lo sirve ReproService (GET /reproduction/animals/:id/status); la identidad/pesos/genealogía,
   * getAnimal. La ficha compone estas fuentes.
   */
  async animalOverview(id: string) {
    await assertAnimal(this.db, id);
    const t = this.db.tenant;
    const base = await this.db.one<any>(
      `SELECT current_lot_id, created_at FROM animals WHERE id = $1 AND tenant_id = $2`,
      [id, t],
    );

    const [movements, treatments, vaccinations, cases, calvings, milk, sinceInLot] = await Promise.all([
      this.db.query<any>(
        `SELECT m.movement_id, m.moved_at, m.reason, m.from_lot_id, m.to_lot_id, m.from_paddock_id, m.to_paddock_id,
                fl.name AS from_lot, tl.name AS to_lot, fp.name AS from_paddock, tp.name AS to_paddock,
                COALESCE(u.full_name, u.email) AS actor
         FROM animal_movements m
         LEFT JOIN lots fl ON fl.id = m.from_lot_id LEFT JOIN lots tl ON tl.id = m.to_lot_id
         LEFT JOIN paddocks fp ON fp.id = m.from_paddock_id LEFT JOIN paddocks tp ON tp.id = m.to_paddock_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.animal_id = $1 AND m.tenant_id = $2 AND m.deleted_at IS NULL
         ORDER BY m.moved_at DESC LIMIT 50`,
        [id, t],
      ),
      this.db.query<any>(
        `SELECT tr.id, tr.applied_at, tr.meat_withdrawal_until, tr.milk_withdrawal_until, tr.notes, pv.name AS product,
                (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now()) AS withdrawal_active
         FROM treatments tr LEFT JOIN products_veterinary pv ON pv.id = tr.product_id
         WHERE tr.animal_id = $1 AND tr.deleted_at IS NULL ORDER BY tr.applied_at DESC LIMIT 15`,
        [id],
      ),
      this.db.query<any>(
        `SELECT v.id, v.applied_at, v.next_due_date, pv.name AS product,
                (v.next_due_date IS NOT NULL AND v.next_due_date < CURRENT_DATE) AS overdue
         FROM vaccinations v LEFT JOIN products_veterinary pv ON pv.id = v.product_id
         WHERE v.animal_id = $1 AND v.deleted_at IS NULL ORDER BY v.applied_at DESC LIMIT 15`,
        [id],
      ),
      this.db.query<any>(
        `SELECT cc.id, cc.status, cc.severity, cc.started_at, (CURRENT_DATE - cc.started_at::date) AS days_open, d.name AS diagnosis
         FROM clinical_cases cc LEFT JOIN diagnoses d ON d.id = cc.diagnosis_id
         WHERE cc.animal_id = $1 AND cc.deleted_at IS NULL AND cc.status IN ('open','in_treatment','observation')
         ORDER BY cc.started_at DESC`,
        [id],
      ),
      this.db.one<any>(`SELECT count(*)::int AS n, max(calving_date)::text AS last FROM calvings WHERE dam_id = $1 AND deleted_at IS NULL`, [id]),
      this.db.one<any>(
        `SELECT count(*)::int AS days, round(sum(total_liters)::numeric, 1)::float AS total_liters,
                round(avg(total_liters)::numeric, 1)::float AS avg_liters
         FROM milk_production_daily WHERE animal_id = $1 AND deleted_at IS NULL AND production_date >= CURRENT_DATE - 30`,
        [id],
      ),
      // Tiempo en el lote actual: primer ingreso al lote vigente (o el alta si nunca se movió).
      base?.current_lot_id
        ? this.db.one<any>(
            `SELECT min(moved_at)::text AS since FROM animal_movements
             WHERE animal_id = $1 AND to_lot_id = $2 AND deleted_at IS NULL`,
            [id, base.current_lot_id],
          )
        : Promise.resolve(null),
    ]);

    const daysInLot = base?.current_lot_id
      ? Math.max(0, Math.floor((Date.now() - new Date(sinceInLot?.since ?? base.created_at).getTime()) / 86400000))
      : null;

    return {
      movements: movements.map((m: any) => {
        const kind =
          m.to_lot_id && m.from_lot_id !== m.to_lot_id && m.to_lot_id !== m.from_lot_id
            ? m.from_lot_id
              ? 'rotacion'
              : 'ingreso'
            : !m.to_lot_id
              ? 'salida'
              : 'rotacion';
        return { ...m, kind };
      }),
      days_in_current_lot: daysInLot,
      health: {
        treatments,
        vaccinations,
        open_cases: cases,
        vaccination_overdue: vaccinations.filter((v: any) => v.overdue).length,
      },
      production: {
        calvings: calvings?.n ?? 0,
        last_calving: calvings?.last ?? null,
        milk_30d: (milk?.days ?? 0) > 0 ? milk : null,
      },
    };
  }

  /**
   * Cambio de categoría MASIVO (A360 E5): valida species + sexo↔categoría por animal; los que no
   * encajan (o no están activos) se omiten. Versiona category_code y propaga por sync. Idempotente.
   */
  async bulkChangeCategory(animalIds: string[], categoryCode: string): Promise<{ changed: number; skipped: number }> {
    const t = this.db.tenant;
    const ids = [...new Set((animalIds ?? []).filter((x) => typeof x === 'string'))];
    if (!ids.length) throw new BadRequestException({ code: 'category.empty', title: 'Sin animales seleccionados' });
    const cat = await this.db.one<{ id: string; species_id: string; sex: string | null }>(
      `SELECT id, species_id, sex FROM animal_categories WHERE code = $1`,
      [categoryCode],
    );
    if (!cat) throw new BadRequestException({ code: 'animal.invalid_category', title: 'Categoría inexistente' });

    let changed = 0;
    await this.db.tx(async (q) => {
      const animals = await q.query<{ id: string; sex: string; species_id: string; category_id: string | null }>(
        `SELECT id, sex, species_id, category_id FROM animals WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
        [ids, t],
      );
      for (const a of animals) {
        if (a.species_id !== cat.species_id) continue; // otra especie → omitir
        if (cat.sex && cat.sex !== 'any' && cat.sex !== a.sex) continue; // sexo incompatible → omitir
        if (a.category_id === cat.id) { changed++; continue; } // ya en esa categoría (idempotente)
        await q.query(`UPDATE animals SET category_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [cat.id, a.id, t]);
        const op = await this.writer.projectAnimalUpdate(q, a.id, { category_code: categoryCode });
        if (op) await this.writer.emitServerOrigin(q, [op], `rest:animal:category:${a.id}:${op.hlc}`);
        await q.query(
          `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
           VALUES ($1,$2,'edit',$3,now(),now(),'manual')`,
          [t, a.id, JSON.stringify({ changes: ['categoría'] })],
        );
        changed++;
      }
    });
    return { changed, skipped: ids.length - changed };
  }

  /** Reemplaza la composición racial (A360 E4). Fracciones normalizadas si no vienen. */
  async setBreeds(animalId: string, breeds: { breed_id: string; fraction?: number }[]) {
    await assertAnimal(this.db, animalId);
    const t = this.db.tenant;
    await this.db.tx(async (q) => {
      await this.setBreedsInTx(q, animalId, breeds);
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'edit',$3,now(),now(),'manual')`,
        [t, animalId, JSON.stringify({ changes: ['raza'] })],
      );
    });
    return this.getAnimal(animalId);
  }

  /** Reemplazo estructural de razas dentro de una tx (compartido por alta y edición). */
  private async setBreedsInTx(q: Q, animalId: string, breeds: { breed_id: string; fraction?: number }[]) {
    const t = this.db.tenant;
    const list = (breeds ?? []).filter((b) => b && b.breed_id);
    // Valida que las razas existan (globales o del tenant).
    if (list.length) {
      const ids = list.map((b) => b.breed_id);
      const found = await q.query<{ id: string }>(
        `SELECT id FROM breeds WHERE id = ANY($1) AND deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $2)`,
        [ids, t],
      );
      if (found.length !== new Set(ids).size)
        throw new BadRequestException({ code: 'animal.invalid_breed', title: 'Alguna raza no existe' });
    }
    await q.query(`DELETE FROM animal_breeds WHERE animal_id = $1`, [animalId]);
    for (const b of list) {
      const frac = b.fraction != null && !Number.isNaN(Number(b.fraction)) ? Number(b.fraction) : 1 / list.length;
      await q.query(`INSERT INTO animal_breeds (tenant_id, animal_id, breed_id, fraction) VALUES ($1,$2,$3,$4)`, [t, animalId, b.breed_id, frac]);
    }
  }

  /**
   * Edición completa del animal (A360 E2) — regla y escritura ÚNICAS. Diff-aware:
   * solo se escribe/versiona/propaga lo que REALMENTE cambia. Todo en una transacción:
   *   · valida (caravana duplicada excluyendo al propio, categoría existente y del mismo
   *     species, sexo compatible con categoría, sexo no rompe vínculos F/M vigentes,
   *     madre hembra / padre macho / sin autorreferencia / sin ciclo);
   *   · aplica columnas de `animals` + rename del identificador visual;
   *   · proyecta al canal de sync (LWW, actor server) y emite changeset de origen servidor;
   *   · deja un hecho `edit` en el timeline con el resumen de cambios importantes.
   * NUNCA toca current_lot_id/current_paddock_id (eso viaja por el servicio de movimientos).
   */
  async updateAnimal(id: string, body: any) {
    const cur = await this.db.one<any>(
      `SELECT a.id, a.species_id, a.sex, a.status, a.origin, a.birth_date, a.birth_date_estimated,
              a.acquisition_date, a.coat_color, a.name, a.notes, a.dam_id, a.sire_id, a.category_id,
              c.code AS category_code, c.sex AS category_sex
       FROM animals a LEFT JOIN animal_categories c ON c.id = a.category_id
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!cur) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });

    const bad = (code: string, title: string) => new BadRequestException({ code, title });
    const dateStr = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);

    await this.db.tx(async (q) => {
      const setCols: string[] = [];
      const setArgs: unknown[] = [];
      const sync: Record<string, unknown> = {}; // campos lógicos para la proyección de sync
      const changes: string[] = []; // resumen de cambios IMPORTANTES para el timeline
      const col = (name: string, val: unknown) => {
        setArgs.push(val);
        setCols.push(`${name} = $${setArgs.length}`);
      };

      if (body.name !== undefined) {
        const v = typeof body.name === 'string' && body.name.trim() === '' ? null : body.name ?? null;
        if (v !== cur.name) { col('name', v); sync.name = v; changes.push('nombre'); }
      }
      if (body.coat_color !== undefined) {
        const v = typeof body.coat_color === 'string' && body.coat_color.trim() === '' ? null : body.coat_color ?? null;
        if (v !== cur.coat_color) { col('coat_color', v); sync.coat_color = v; }
      }
      if (body.notes !== undefined) {
        const v = typeof body.notes === 'string' && body.notes.trim() === '' ? null : body.notes ?? null;
        if (v !== cur.notes) { col('notes', v); sync.notes = v; }
      }
      if (body.origin !== undefined && body.origin !== cur.origin) {
        if (!['born', 'purchased', 'transferred'].includes(body.origin)) throw bad('animal.invalid_origin', 'Origen inválido');
        col('origin', body.origin);
        changes.push('origen');
      }
      if (body.birth_date !== undefined) {
        const v = body.birth_date === '' ? null : body.birth_date ?? null;
        if (v != null) {
          if (Number.isNaN(Date.parse(v))) throw bad('animal.invalid_birth_date', 'Fecha de nacimiento inválida');
          if (new Date(v) > new Date()) throw bad('animal.birth_date_future', 'La fecha de nacimiento no puede ser futura');
        }
        if (v !== dateStr(cur.birth_date)) { col('birth_date', v); sync.birth_date = v; changes.push('fecha de nacimiento'); }
      }
      if (body.birth_date_estimated !== undefined && !!body.birth_date_estimated !== !!cur.birth_date_estimated) {
        col('birth_date_estimated', !!body.birth_date_estimated);
      }
      if (body.acquisition_date !== undefined) {
        const v = body.acquisition_date === '' ? null : body.acquisition_date ?? null;
        if (v != null && Number.isNaN(Date.parse(v))) throw bad('animal.invalid_acquisition_date', 'Fecha de adquisición inválida');
        if (v !== dateStr(cur.acquisition_date)) col('acquisition_date', v);
      }

      // Sexo/categoría: se resuelve el efectivo y se exige compatibilidad (category.sex ∈ {any, sexo}).
      let effSex: string = cur.sex;
      let effCatSex: string | null = cur.category_sex;

      if (body.category_code !== undefined && body.category_code !== cur.category_code) {
        const cat = await q.one<{ id: string; species_id: string; sex: string | null }>(
          `SELECT id, species_id, sex FROM animal_categories WHERE code = $1`,
          [body.category_code],
        );
        if (!cat) throw bad('animal.invalid_category', 'Categoría inexistente');
        if (cat.species_id !== cur.species_id) throw bad('animal.category_species_mismatch', 'La categoría es de otra especie');
        col('category_id', cat.id);
        sync.category_code = body.category_code;
        effCatSex = cat.sex;
        changes.push('categoría');
      }

      if (body.sex !== undefined && body.sex !== cur.sex) {
        if (!Sex.isValid(body.sex)) throw bad('animal.invalid_sex', "Sexo inválido: se esperaba 'F' o 'M'");
        // No cambiar el sexo si rompe vínculos genealógicos vigentes (madre debe ser F, padre M).
        const refs = await q.one<{ as_dam: number; as_sire: number }>(
          `SELECT count(*) FILTER (WHERE dam_id = $1)::int AS as_dam, count(*) FILTER (WHERE sire_id = $1)::int AS as_sire
           FROM animals WHERE tenant_id = $2 AND deleted_at IS NULL`,
          [id, this.db.tenant],
        );
        if (body.sex === 'M' && (refs?.as_dam ?? 0) > 0) throw bad('animal.sex_conflict_dam', 'Es madre de otros animales; no puede pasar a macho');
        if (body.sex === 'F' && (refs?.as_sire ?? 0) > 0) throw bad('animal.sex_conflict_sire', 'Es padre de otros animales; no puede pasar a hembra');
        col('sex', body.sex);
        sync.sex = body.sex;
        effSex = body.sex;
        changes.push('sexo');
      }

      if (effCatSex && effCatSex !== 'any' && effCatSex !== effSex)
        throw bad('animal.sex_category_mismatch', `La categoría requiere sexo ${effCatSex === 'F' ? 'hembra' : 'macho'}`);

      // Genealogía (madre/padre): existe, sexo correcto, sin autorreferencia, sin ciclo.
      for (const [field, colName, reqSex] of [
        ['dam_id', 'dam_id', 'F'],
        ['sire_id', 'sire_id', 'M'],
      ] as const) {
        if (body[field] === undefined) continue;
        const v = body[field] === '' || body[field] === null ? null : body[field];
        if (v === cur[colName]) continue;
        if (v != null) {
          if (v === id) throw bad('animal.genealogy_self_ref', 'Un animal no puede ser su propio progenitor');
          // La cría puede estar cambiando su propia fecha en esta MISMA llamada: se compara contra
          // la que va a quedar, no contra la que había. Si no, editar las dos cosas juntas dejaría
          // pasar el vínculo imposible.
          await this.writer.requireParent(q, v, field, body.birth_date !== undefined ? body.birth_date : dateStr(cur.birth_date));
          const cyc = await this.writer.detectCycles(q, [{ childId: id, parentId: v }]);
          if (cyc.get(`${id}|${v}`) !== 'ok') throw bad('animal.genealogy_cycle', 'El vínculo crearía un ciclo genealógico');
        }
        col(colName, v);
        sync[colName] = v;
        changes.push(field === 'dam_id' ? 'madre' : 'padre');
      }

      // Rename de la caravana visual (identificador) — duplicado activo excluyendo al propio.
      if (body.visual_tag !== undefined && body.visual_tag !== null && String(body.visual_tag).trim() !== '') {
        if (!TagNumber.isValid(body.visual_tag)) throw bad('animal.invalid_tag', 'Caravana inválida');
        const tag = TagNumber.of(body.visual_tag);
        const curVisual = await q.one<{ id: string; value: string }>(
          `SELECT id, value FROM animal_identifiers WHERE animal_id = $1 AND type = 'visual' AND deleted_at IS NULL AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`,
          [id],
        );
        if (!curVisual || curVisual.value !== tag) {
          const dup = await q.one(
            `SELECT 1 FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
             WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = $2 AND ai.deleted_at IS NULL AND ai.retired_at IS NULL AND a.status = 'active' AND a.id <> $3`,
            [this.db.tenant, tag, id],
          );
          if (dup) throw bad('animal.duplicate_tag', `Ya existe un animal activo con caravana ${tag}`);
          if (curVisual) await q.query(`UPDATE animal_identifiers SET value = $1, updated_at = now() WHERE id = $2`, [tag, curVisual.id]);
          else await q.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [this.db.tenant, id, tag]);
          sync.visual_tag = tag;
          changes.push('caravana');
        }
      }

      if (setCols.length) {
        setArgs.push(id, this.db.tenant);
        await q.query(
          `UPDATE animals SET ${setCols.join(', ')}, updated_at = now() WHERE id = $${setArgs.length - 1} AND tenant_id = $${setArgs.length}`,
          setArgs,
        );
      }

      // Proyección server-origin: cada campo cambiado se versiona con un tick genuino del
      // actor server. `hlc` (único por tick) es el discriminador del originRef → dos ediciones
      // distintas NUNCA colisionan en el dedup.
      const op = await this.writer.projectAnimalUpdate(q, id, sync);
      if (op) await this.writer.emitServerOrigin(q, [op], `rest:animal:update:${id}:${op.hlc}`);

      if (changes.length)
        await q.query(
          `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
           VALUES ($1,$2,'edit',$3,now(),now(),'manual')`,
          [this.db.tenant, id, JSON.stringify({ changes })],
        );
    });

    // getAnimal fuera de la tx (usa this.db): evita bloquear la conexión única de PGlite.
    return this.getAnimal(id);
  }

  /** Evento polimórfico (POST /animals/:id/events) — como en el doc de APIs. */
  async registerEvent(id: string, body: any) {
    await assertAnimal(this.db, id);
    const occurredAt = body.occurred_at ?? new Date().toISOString();

    if (body.type === 'weighing') {
      const kg = Number(body.weight_kg);
      // Errores DUROS de la regla única de dominio (vacío/no numérico/no positivo/absurdo).
      const v = validateWeighing({ weightKg: kg });
      if (!v.ok) throw new BadRequestException({ code: 'weighing.invalid_weight', title: v.error!.message });
      const inserted = await this.db.one<{ id: string }>(
        `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, body_condition)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [this.db.tenant, id, occurredAt, kg, body.method ?? 'scale', body.body_condition ?? null],
      );
      const derived = await this.db.one<{ adg_since_last: number | null }>(
        `SELECT adg_since_last::float FROM v_weighings WHERE id = $1`,
        [inserted?.id],
      );
      // `weighing_id` en el payload → permite deshacer (borra pesada + su evento) desde la manga.
      const ev = await this.insertEvent(id, 'weighing', { weight_kg: kg, weighing_id: inserted?.id }, occurredAt);
      return { ...ev, weighing_id: inserted?.id, adg_since_last: derived?.adg_since_last ?? null };
    }

    if (body.type === 'note') {
      return this.insertEvent(id, 'note', { text: body.text ?? '' }, occurredAt);
    }

    throw new BadRequestException({ code: 'event.unsupported_type', title: `Tipo de evento no soportado aún: ${body.type}` });
  }

  /**
   * Deshacer una pesada (A-Manga E6) — soft-delete SEGURO de la pesada y su evento de timeline.
   * v_weighings excluye las borradas → el último peso/GDP se recalculan solos. Solo pesadas
   * (aditivas y reversibles); tratamientos/vacunas/movimientos NO se deshacen desde acá (efectos).
   */
  async deleteWeighing(weighingId: string) {
    const t = this.db.tenant;
    const w = await this.db.one<{ id: string }>(
      `SELECT id FROM weighings WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [weighingId, t],
    );
    if (!w) throw new NotFoundException({ code: 'weighing.not_found', title: 'Pesada no encontrada o ya deshecha' });
    await this.db.tx(async (q) => {
      await q.query(`UPDATE weighings SET deleted_at = now() WHERE id = $1 AND tenant_id = $2`, [weighingId, t]);
      await q.query(
        `UPDATE animal_events SET deleted_at = now()
         WHERE tenant_id = $1 AND event_type = 'weighing' AND deleted_at IS NULL AND payload->>'weighing_id' = $2`,
        [t, weighingId],
      );
    });
    return { undone: true };
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
}
