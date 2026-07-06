import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { signFileToken } from '../../common/file-token';

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
  limit?: number;
  cursor?: string;
}

@Injectable()
export class HerdService {
  constructor(private readonly db: DbService) {}

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
         SELECT weight_kg, adg_since_last, weighed_at FROM weighings w
         WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY w.weighed_at DESC LIMIT 1) w ON true
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
         FROM weighings WHERE animal_id = $1 AND deleted_at IS NULL ORDER BY weighed_at DESC LIMIT 1`,
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
         SELECT weight_kg, weighed_at FROM weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY weighed_at DESC LIMIT 1) w ON true
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
      `SELECT id, event_type, payload, occurred_at, recorded_at, source
       FROM animal_events WHERE animal_id = $1 AND tenant_id = $2
       ORDER BY occurred_at DESC LIMIT 300`,
      [id, this.db.tenant],
    );
  }

  async createAnimal(body: {
    tag: string;
    sex: 'F' | 'M';
    category_code: string;
    name?: string;
    birth_date?: string;
    lot_id?: string;
  }) {
    if (!body?.tag || !body?.sex || !body?.category_code)
      throw new BadRequestException({ code: 'animal.missing_fields', title: 'tag, sex y category_code son obligatorios' });

    const cat = await this.db.one<any>(
      `SELECT c.id, c.species_id FROM animal_categories c WHERE c.code = $1`,
      [body.category_code],
    );
    if (!cat) throw new BadRequestException({ code: 'animal.invalid_category', title: 'Categoría inexistente' });

    const dup = await this.db.one(
      `SELECT ai.id FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
       WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = $2 AND ai.deleted_at IS NULL AND a.status = 'active'`,
      [this.db.tenant, body.tag],
    );
    if (dup)
      throw new BadRequestException({ code: 'animal.duplicate_tag', title: `Ya existe un animal activo con caravana ${body.tag}` });

    const animal = await this.db.one<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, name, birth_date, origin, current_lot_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'born',$8,'active') RETURNING id`,
      [this.db.tenant, await this.db.defaultFarm(), cat.species_id, cat.id, body.sex, body.name ?? null, body.birth_date ?? null, body.lot_id ?? null],
    );
    await this.db.query(
      `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`,
      [this.db.tenant, animal.id, body.tag],
    );
    await this.insertEvent(animal.id, 'birth', { origin: 'manual', tag: body.tag }, body.birth_date ?? new Date().toISOString());
    return this.getAnimal(animal.id);
  }

  /** Evento polimórfico (POST /animals/:id/events) — como en el doc de APIs. */
  async registerEvent(id: string, body: any) {
    await this.assertAnimal(id);
    const occurredAt = body.occurred_at ?? new Date().toISOString();

    if (body.type === 'weighing') {
      const kg = Number(body.weight_kg);
      if (!kg || kg <= 0)
        throw new BadRequestException({ code: 'weighing.invalid_weight', title: 'weight_kg debe ser positivo' });
      const prev = await this.db.one<any>(
        `SELECT weight_kg::float AS kg, weighed_at FROM weighings
         WHERE animal_id = $1 AND deleted_at IS NULL AND weighed_at < $2 ORDER BY weighed_at DESC LIMIT 1`,
        [id, occurredAt],
      );
      const adg = prev
        ? +(((kg - prev.kg) / Math.max(1, (new Date(occurredAt).getTime() - new Date(prev.weighed_at).getTime()) / 86400000))).toFixed(3)
        : null;
      await this.db.query(
        `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, adg_since_last, body_condition)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [this.db.tenant, id, occurredAt, kg, body.method ?? 'scale', adg, body.body_condition ?? null],
      );
      const ev = await this.insertEvent(id, 'weighing', { weight_kg: kg, adg_since_last: adg }, occurredAt);
      return { ...ev, adg_since_last: adg };
    }

    if (body.type === 'note') {
      return this.insertEvent(id, 'note', { text: body.text ?? '' }, occurredAt);
    }

    throw new BadRequestException({ code: 'event.unsupported_type', title: `Tipo de evento no soportado aún: ${body.type}` });
  }

  async lots() {
    return this.db.query(
      `SELECT l.id, l.name, l.purpose, p.name AS paddock_name,
              (SELECT count(*)::int FROM animals a WHERE a.current_lot_id = l.id AND a.status='active' AND a.deleted_at IS NULL) AS animal_count
       FROM lots l LEFT JOIN paddocks p ON p.id = l.current_paddock_id
       WHERE l.tenant_id = $1 AND l.deleted_at IS NULL ORDER BY l.name`,
      [this.db.tenant],
    );
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
