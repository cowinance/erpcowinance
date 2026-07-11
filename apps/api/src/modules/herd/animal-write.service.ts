import { Injectable } from '@nestjs/common';
import { Sex, TagNumber } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * Persistencia estructural neutral de un animal — regla y escritura ÚNICAS,
 * compartidas por el canal REST (alta manual) y, más adelante, por el canal de
 * importación (P2). La semántica de cada canal entra como CONTEXTO explícito
 * (`PersistAnimalContext`), no como condicionales dispersos por el cuerpo.
 *
 * Descomposición (D1, aprobada):
 *   (a) normalizeAndValidate  — PURA (sin DB): VOs + normalización.
 *   (b) checkAgainstDb        — validaciones que leen la base (categoría, duplicado).
 *   (c) persistNewAnimal      — inserción estructural (animal + identificador + timeline).
 *
 * Oleada 1: `sync='server_origin'` NO está implementado todavía (la proyección
 * de sync con HLC de servidor llega en la oleada 3). El único consumidor hoy es
 * REST, con `sync='none'`.
 */

export interface RowError {
  field: string;
  code: 'required' | 'invalid' | 'not_found';
  message: string;
}

/** Input ya normalizado y validado estructuralmente, listo para persistir. */
export interface NormalizedAnimalInput {
  tag: string;
  sex: 'F' | 'M';
  categoryCode: string;
  name: string | null;
  birthDate: string | null;
  lotId: string | null;
  origin: 'born' | 'purchased' | 'transferred';
}

/** Semántica del canal — la arma cada adaptador (REST/Import), no el cuerpo de persistencia. */
export interface PersistAnimalContext {
  origin: 'rest' | 'import';
  /** Actor que origina el alta. Reservado para provenance de canal (no se escribe en oleada 1). */
  actorUserId: string;
  timeline: { eventType: string; source: 'manual' | 'import'; occurredAt?: string };
  sync: 'none' | 'server_origin';
}

export type NormalizeResult =
  | { ok: true; input: NormalizedAnimalInput }
  | { ok: false; errors: RowError[] };

export type CheckResult =
  | { ok: true; resolved: { categoryId: string; speciesId: string } }
  | { ok: false; errors: RowError[] }
  | { skip: 'duplicate_active_tag'; existingAnimalId: string };

const ORIGINS = new Set(['born', 'purchased', 'transferred']);

/** Campos crudos que ambos canales mapean a un alta de animal. */
export interface RawAnimalRow {
  tag?: unknown;
  sex?: unknown;
  category_code?: unknown;
  name?: unknown;
  birth_date?: unknown;
  lot_id?: unknown;
  origin?: unknown;
}

@Injectable()
export class AnimalWriteService {
  constructor(private readonly db: DbService) {}

  /**
   * (a) Validación y normalización PURA — sin acceso a base de datos.
   * Usa los VOs del dominio (`TagNumber` normaliza la caravana; `Sex` valida el
   * conjunto cerrado {F,M}). No decide side-effects ni consulta duplicados.
   */
  normalizeAndValidate(raw: RawAnimalRow): NormalizeResult {
    const errors: RowError[] = [];

    // Caravana (TagNumber): obligatoria + normalizada (sin espacios sobrantes).
    let tag = '';
    if (!raw.tag || (typeof raw.tag === 'string' && raw.tag.trim() === '')) {
      errors.push({ field: 'tag', code: 'required', message: 'La caravana es obligatoria' });
    } else if (!TagNumber.isValid(raw.tag)) {
      errors.push({ field: 'tag', code: 'invalid', message: 'Caravana inválida' });
    } else {
      tag = TagNumber.of(raw.tag as string);
    }

    // Sexo (Sex): obligatorio + conjunto cerrado {F,M}.
    if (raw.sex === undefined || raw.sex === null || raw.sex === '') {
      errors.push({ field: 'sex', code: 'required', message: 'El sexo es obligatorio' });
    } else if (!Sex.isValid(raw.sex)) {
      errors.push({ field: 'sex', code: 'invalid', message: "Sexo inválido: se esperaba 'F' o 'M'" });
    }

    // Categoría (código): obligatoria (su existencia se valida contra la base en (b)).
    if (!raw.category_code || (typeof raw.category_code === 'string' && raw.category_code.trim() === '')) {
      errors.push({ field: 'category_code', code: 'required', message: 'La categoría es obligatoria' });
    }

    // Origen: opcional; default 'born' (comportamiento REST). Si viene, valida el enum.
    let origin: NormalizedAnimalInput['origin'] = 'born';
    if (raw.origin !== undefined && raw.origin !== null && raw.origin !== '') {
      if (typeof raw.origin === 'string' && ORIGINS.has(raw.origin)) {
        origin = raw.origin as NormalizedAnimalInput['origin'];
      } else {
        errors.push({ field: 'origin', code: 'invalid', message: 'Origen inválido' });
      }
    }

    if (errors.length) return { ok: false, errors };

    return {
      ok: true,
      input: {
        tag,
        sex: raw.sex as 'F' | 'M',
        categoryCode: raw.category_code as string,
        name: (raw.name as string) ?? null,
        birthDate: (raw.birth_date as string) ?? null,
        lotId: (raw.lot_id as string) ?? null,
        origin,
      },
    };
  }

  /**
   * (b) Validaciones que REQUIEREN lectura de base (no puras):
   *  - la categoría existe (resuelve category_id + species_id);
   *  - no hay otro animal ACTIVO con la misma caravana visual (regla de dominio).
   */
  async checkAgainstDb(q: Q, input: NormalizedAnimalInput): Promise<CheckResult> {
    const cat = await q.one<{ id: string; species_id: string }>(
      `SELECT c.id, c.species_id FROM animal_categories c WHERE c.code = $1`,
      [input.categoryCode],
    );
    if (!cat) {
      return { ok: false, errors: [{ field: 'category_code', code: 'not_found', message: 'Categoría inexistente' }] };
    }

    const dup = await q.one<{ animal_id: string }>(
      `SELECT a.id AS animal_id FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
       WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = $2 AND ai.deleted_at IS NULL AND a.status = 'active'`,
      [this.db.tenant, input.tag],
    );
    if (dup) return { skip: 'duplicate_active_tag', existingAnimalId: dup.animal_id };

    return { ok: true, resolved: { categoryId: cat.id, speciesId: cat.species_id } };
  }

  /**
   * (c) Inserción estructural ÚNICA de un animal ya validado: fila de `animals`,
   * identificador visual y hecho de timeline. La semántica de canal (tipo de
   * evento, fuente) entra por `ctx`; el cuerpo no ramifica por canal.
   */
  async persistNewAnimal(
    q: Q,
    input: NormalizedAnimalInput,
    ctx: PersistAnimalContext,
    resolved: { categoryId: string; speciesId: string },
  ): Promise<{ animalId: string }> {
    if (ctx.sync === 'server_origin') {
      // Proyección de sync con HLC de servidor: oleada 3 (ADR-0016). No debe
      // invocarse aún; fallar fuerte evita un server-origin a medias.
      throw new Error('persistNewAnimal: sync="server_origin" no implementado (oleada 3)');
    }

    const t = this.db.tenant;
    const animal = await q.one<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, name, birth_date, origin, current_lot_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [
        t,
        await this.db.defaultFarm(),
        resolved.speciesId,
        resolved.categoryId,
        input.sex,
        input.name,
        input.birthDate,
        input.origin,
        input.lotId,
      ],
    );

    await q.query(
      `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`,
      [t, animal!.id, input.tag],
    );

    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,now(),$6)`,
      [
        t,
        animal!.id,
        ctx.timeline.eventType,
        JSON.stringify({ origin: ctx.timeline.source, tag: input.tag }),
        ctx.timeline.occurredAt ?? input.birthDate ?? new Date().toISOString(),
        ctx.timeline.source,
      ],
    );

    return { animalId: animal!.id };
  }

  /**
   * Contexto de validación en LOTE para el preview de importación (P2 3.5): en
   * DOS queries resuelve, para todo el batch, qué códigos de categoría existen y
   * qué caravanas están activas (→ animalId). Evita el N+1 de `checkAgainstDb`
   * fila por fila. La regla autoritativa sigue en `checkAgainstDb` (el commit
   * revalida); esto es la resolución batch del contexto que el preview necesita.
   */
  async loadAnimalImportValidationContext(input: { categoryCodes: string[]; tags: string[] }): Promise<{
    existingCategoryCodes: Set<string>;
    activeTags: Map<string, string>;
  }> {
    const codes = [...new Set(input.categoryCodes)].filter((c) => typeof c === 'string' && c !== '');
    const tags = [...new Set(input.tags)].filter((t) => typeof t === 'string' && t !== '');
    const cats = codes.length
      ? await this.db.query<{ code: string }>(`SELECT code FROM animal_categories WHERE code = ANY($1)`, [codes])
      : [];
    const active = tags.length
      ? await this.db.query<{ tag: string; animal_id: string }>(
          `SELECT ai.value AS tag, a.id AS animal_id
           FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
           WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = ANY($2) AND ai.deleted_at IS NULL AND a.status = 'active'`,
          [this.db.tenant, tags],
        )
      : [];
    return {
      existingCategoryCodes: new Set(cats.map((c) => c.code)),
      activeTags: new Map(active.map((r) => [r.tag, r.animal_id])),
    };
  }
}
