import { Injectable } from '@nestjs/common';
import { Sex, TagNumber } from '@cowinance/domain';
import { HlcClock } from '@cowinance/sync-core';
import type { Op, PutOp } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { ANIMAL_SYNCABLE_FIELDS } from './animal-syncable-fields';

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
 * `sync='server_origin'` (P-b, ADR-0016): además del insert estructural, proyecta
 * el animal al canal de sync (versiones HLC del actor `server` en sync_row_state)
 * y devuelve el `syncOp` para que el caller lo emita como changeset de origen
 * servidor (propagación incremental por pull). `sync='none'` omite la proyección.
 */

export interface RowError {
  field: string;
  code: 'required' | 'invalid' | 'not_found' | 'duplicate';
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
  /** Importación (Fase 3c): valores por NOMBRE que `checkAgainstDb` resuelve a ids. */
  breedName: string | null;
  lotName: string | null;
  rfid: string | null;
  officialId: string | null;
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
  | { ok: true; resolved: { categoryId: string; speciesId: string; breedId?: string | null; lotId?: string | null } }
  | { ok: false; errors: RowError[] }
  | { skip: 'duplicate_active_tag'; existingAnimalId: string };

/** Resultado de un vínculo genealógico (dam/sire) de una fila. `linked` es interno. */
export interface LinkOutcome {
  field: 'dam' | 'sire';
  outcome: 'linked' | 'not_found' | 'sex_incompatible' | 'self_ref' | 'cycle' | 'cycle_check_limit';
}

/** Candidato hijo→padre para la detección de ciclos batch. */
export interface GenealogyPair {
  childId: string;
  parentId: string;
}

/** Orígenes aceptados. Exportado para que la ayuda de la importación los MUESTRE sin copiarlos. */
export const ORIGINS = new Set(['born', 'purchased', 'transferred']);

/** Campos crudos que ambos canales mapean a un alta de animal. */
export interface RawAnimalRow {
  tag?: unknown;
  sex?: unknown;
  category_code?: unknown;
  name?: unknown;
  birth_date?: unknown;
  lot_id?: unknown;
  origin?: unknown;
  breed?: unknown;
  lot?: unknown;
  rfid?: unknown;
  official_id?: unknown;
}

@Injectable()
export class AnimalWriteService {
  /** Nodo HLC del servidor (ADR-0007): actor legítimo del sistema distribuido. */
  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly serverOrigin: ServerOriginChangesetWriter,
  ) {}

  /**
   * (a) Validación y normalización PURA — sin acceso a base de datos.
   * Usa los VOs del dominio (`TagNumber` normaliza la caravana; `Sex` valida el
   * conjunto cerrado {F,M}). No decide side-effects ni consulta duplicados.
   */
  normalizeAndValidate(raw: RawAnimalRow): NormalizeResult {
    const errors: RowError[] = [];
    /** Texto opcional de planilla: recorta y trata el vacío como ausente. */
    const str = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      const t = String(v).trim();
      return t === '' ? null : t;
    };

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
    //
    // Se INTERPRETA cómo viene escrito (`Sex.parse`) en vez de exigir la forma almacenada. La
    // planilla la escribe el productor, y en castellano la notación de campo es H de hembra: pedir
    // `F` rechazaba la mitad exacta de cada importación —todas las hembras— y lo mandaba a hacer
    // buscar-y-reemplazar en el Excel. Los encabezados ya eran generosos (`caravana`, `arete`,
    // `crotal`); la generosidad se cortaba justo en los valores.
    let sex: 'F' | 'M' | null = null;
    if (raw.sex === undefined || raw.sex === null || String(raw.sex).trim() === '') {
      errors.push({ field: 'sex', code: 'required', message: 'El sexo es obligatorio' });
    } else {
      sex = Sex.parse(raw.sex);
      if (sex === null) {
        errors.push({
          field: 'sex',
          code: 'invalid',
          message: `Sexo inválido: se esperaba H o M (hembra/macho); también se aceptan F/M`,
        });
      }
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
        sex: sex as 'F' | 'M',
        categoryCode: raw.category_code as string,
        name: (raw.name as string) ?? null,
        birthDate: (raw.birth_date as string) ?? null,
        lotId: (raw.lot_id as string) ?? null,
        origin,
        breedName: str(raw.breed),
        lotName: str(raw.lot),
        rfid: str(raw.rfid),
        officialId: str(raw.official_id),
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

    // ── Importación (Fase 3c): resolución por NOMBRE + duplicados de identificadores ──
    // Raza: global (tenant_id NULL) o del tenant. Nombre inexistente → error de fila, no se crea.
    let breedId: string | null = null;
    if (input.breedName) {
      const b = await q.one<{ id: string }>(
        `SELECT id FROM breeds WHERE lower(name) = lower($1) AND deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $2) LIMIT 1`,
        [input.breedName, this.db.tenant],
      );
      if (!b) return { ok: false, errors: [{ field: 'breed', code: 'not_found', message: `Raza inexistente: ${input.breedName}` }] };
      breedId = b.id;
    }
    // Lote: por nombre dentro del tenant.
    let lotId: string | null = null;
    if (input.lotName) {
      const l = await q.one<{ id: string }>(
        `SELECT id FROM lots WHERE lower(name) = lower($1) AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [input.lotName, this.db.tenant],
      );
      if (!l) return { ok: false, errors: [{ field: 'lot', code: 'not_found', message: `Lote inexistente: ${input.lotName}` }] };
      lotId = l.id;
    }
    // RFID / ID oficial: no pueden chocar con otro animal ACTIVO (mismo tipo, no retirado).
    for (const [value, type, field] of [
      [input.rfid, 'rfid', 'rfid'],
      [input.officialId, 'official', 'official_id'],
    ] as const) {
      if (!value) continue;
      const clash = await q.one<{ id: string }>(
        `SELECT ai.id FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
         WHERE ai.tenant_id = $1 AND ai.type = $2 AND ai.value = $3
           AND ai.deleted_at IS NULL AND ai.retired_at IS NULL AND a.status = 'active'`,
        [this.db.tenant, type, value],
      );
      if (clash) return { ok: false, errors: [{ field, code: 'duplicate', message: `Ya hay un animal activo con ${field} ${value}` }] };
    }

    return { ok: true, resolved: { categoryId: cat.id, speciesId: cat.species_id, breedId, lotId } };
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
    resolved: { categoryId: string; speciesId: string; breedId?: string | null; lotId?: string | null },
  ): Promise<{ animalId: string; syncOp?: PutOp }> {
    const t = this.db.tenant;
    const animal = await q.one<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, name, birth_date, origin, current_lot_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [
        t,
        await this.db.defaultFarm(q), // `q`: se resuelve DENTRO de la tx — sin él, la caché fría cuelga la conexión
        resolved.speciesId,
        resolved.categoryId,
        input.sex,
        input.name,
        input.birthDate,
        input.origin,
        input.lotId ?? resolved.lotId ?? null,
      ],
    );

    await q.query(
      `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`,
      [t, animal!.id, input.tag],
    );

    // Importación (Fase 3c): identificadores extra y raza vienen de la planilla ya resueltos/
    // validados por `checkAgainstDb`. El oficial se marca is_official (único por animal).
    if (input.rfid) {
      await q.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'rfid',$3)`, [t, animal!.id, input.rfid]);
    }
    if (input.officialId) {
      await q.query(
        `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value, is_official) VALUES ($1,$2,'official',$3,true)`,
        [t, animal!.id, input.officialId],
      );
    }
    if (resolved.breedId) {
      await q.query(`INSERT INTO animal_breeds (tenant_id, animal_id, breed_id, fraction) VALUES ($1,$2,$3,1)`, [t, animal!.id, resolved.breedId]);
    }

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

    if (ctx.sync !== 'server_origin') return { animalId: animal!.id };

    // Proyección server-origin (ADR-0016): versiona los campos del animal con un
    // tick GENUINO del actor `server` en sync_row_state y devuelve el `syncOp` (put)
    // que el caller emitirá como changeset de origen servidor. Es una creación → sin
    // conflicto. visual_tag/category_code son campos lógicos (identificador/category);
    // el resto son campos syncables reales (ANIMAL_SYNCABLE_FIELDS) con valor.
    const fields: Record<string, unknown> = {
      visual_tag: input.tag,
      category_code: input.categoryCode,
      status: 'active',
      sex: input.sex,
    };
    if (input.name !== null) fields.name = input.name;
    if (input.birthDate !== null) fields.birth_date = input.birthDate;
    const effectiveLot = input.lotId ?? resolved.lotId ?? null;
    if (effectiveLot !== null) fields.current_lot_id = effectiveLot;

    const hlc = this.serverClock.tick();
    const versionsMap = Object.fromEntries(Object.keys(fields).map((f) => [f, hlc]));
    await this.versions.write(q, 'animals', animal!.id, versionsMap);

    const syncOp: PutOp = { kind: 'put', table: 'animals', rowId: animal!.id, fields, hlc };
    return { animalId: animal!.id, syncOp };
  }

  /** Emite un changeset de origen servidor con `ops` (dedup por `originRef`). Delega en la infra de sync. */
  async emitServerOrigin(q: Q, ops: Op[], originRef: string): Promise<void> {
    return this.serverOrigin.emit(q, ops, originRef);
  }

  /**
   * Proyecta al canal de sync los campos LÓGICOS que cambian en una EDICIÓN (A360 E2):
   * versiona cada campo con un tick genuino del actor `server` (LWW) y devuelve el `put`
   * para emitir como changeset de origen servidor. `fields` son campos lógicos del cliente
   * (`visual_tag`/`category_code`) o syncables reales (ANIMAL_SYNCABLE_FIELDS) — NUNCA
   * `current_lot_id`/`current_paddock_id` (esos viajan por el servicio de movimientos).
   * Regla única de proyección de escritura de `animals`, hermana de persistNewAnimal/applyGenealogyLink.
   */
  async projectAnimalUpdate(q: Q, animalId: string, fields: Record<string, unknown>): Promise<PutOp | null> {
    const cols = Object.keys(fields);
    if (!cols.length) return null;
    const hlc = this.serverClock.tick();
    const existing = (await this.versions.read(q, 'animals', animalId)) ?? {};
    const merged = { ...existing, ...Object.fromEntries(cols.map((c) => [c, hlc])) };
    await this.versions.write(q, 'animals', animalId, merged);
    return { kind: 'put', table: 'animals', rowId: animalId, fields, hlc };
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

  // ──────────────────── Genealogía (P2 P-d) ────────────────────

  /** Resuelve caravanas de dam/sire → {animalId, sex} en UNA query (animales activos del tenant). */
  async loadGenealogyContext(q: Q, tags: string[]): Promise<Map<string, { animalId: string; sex: string }>> {
    const uniq = [...new Set(tags)].filter((t) => typeof t === 'string' && t !== '');
    if (!uniq.length) return new Map();
    const rows = await q.query<{ tag: string; animal_id: string; sex: string }>(
      `SELECT ai.value AS tag, a.id AS animal_id, a.sex
       FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
       WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = ANY($2) AND ai.deleted_at IS NULL AND a.status = 'active'`,
      [this.db.tenant, uniq],
    );
    return new Map(rows.map((r) => [r.tag, { animalId: r.animal_id, sex: r.sex }]));
  }

  /**
   * Detección de ciclos en LOTE: para todos los pares (child, parent) del chunk,
   * en UNA consulta recursiva determina si el `parentId` propuesto ya tiene al
   * `childId` entre sus ancestros (lo que crearía un ciclo). Profundidad máxima
   * defensiva (32) + protección contra repetir nodos (`path`). Devuelve por par:
   * `cycle` (se encontró el hijo), `cycle_check_limit` (se agotó la profundidad sin
   * concluir → rechazo conservador) u `ok`. Key = `childId|parentId`.
   */
  async detectCycles(q: Q, pairs: GenealogyPair[]): Promise<Map<string, 'cycle' | 'cycle_check_limit' | 'ok'>> {
    const result = new Map<string, 'cycle' | 'cycle_check_limit' | 'ok'>();
    if (!pairs.length) return result;
    const rows = await q.query<{ child_id: string; parent_id: string; is_cycle: boolean; max_depth: number }>(
      `WITH RECURSIVE cand(child_id, parent_id) AS (
         SELECT * FROM unnest($1::uuid[], $2::uuid[]) AS c(child_id, parent_id)
       ),
       anc(child_id, parent_id, node, depth, path) AS (
         SELECT child_id, parent_id, parent_id, 0, ARRAY[parent_id] FROM cand
         UNION ALL
         SELECT a.child_id, a.parent_id, nxt.id, a.depth + 1, a.path || nxt.id
         FROM anc a JOIN animals cur ON cur.id = a.node
         CROSS JOIN LATERAL (VALUES (cur.dam_id), (cur.sire_id)) nxt(id)
         WHERE nxt.id IS NOT NULL AND a.depth < 32 AND NOT (nxt.id = ANY(a.path)) AND a.node <> a.child_id
       )
       SELECT child_id, parent_id, bool_or(node = child_id) AS is_cycle, max(depth) AS max_depth
       FROM anc GROUP BY child_id, parent_id`,
      [pairs.map((p) => p.childId), pairs.map((p) => p.parentId)],
    );
    for (const r of rows) {
      result.set(`${r.child_id}|${r.parent_id}`, r.is_cycle ? 'cycle' : Number(r.max_depth) >= 32 ? 'cycle_check_limit' : 'ok');
    }
    return result;
  }

  /**
   * Evalúa los vínculos de una fila (PURA): usa el contexto de genealogía y los
   * resultados de ciclos ya resueltos en lote. Devuelve los outcomes por vínculo y
   * los `damId`/`sireId` a escribir (solo los válidos). No consulta la base.
   */
  evaluateLink(
    childId: string,
    refs: { damTag?: string; sireTag?: string },
    genCtx: Map<string, { animalId: string; sex: string }>,
    cycles: Map<string, 'cycle' | 'cycle_check_limit' | 'ok'>,
  ): { outcomes: LinkOutcome[]; damId?: string; sireId?: string } {
    const outcomes: LinkOutcome[] = [];
    let damId: string | undefined;
    let sireId: string | undefined;
    const each: [LinkOutcome['field'], string | undefined, 'F' | 'M'][] = [
      ['dam', refs.damTag, 'F'],
      ['sire', refs.sireTag, 'M'],
    ];
    for (const [field, tag, expectSex] of each) {
      if (!tag) continue;
      const resolved = genCtx.get(tag);
      if (!resolved) {
        outcomes.push({ field, outcome: 'not_found' });
        continue;
      }
      if (resolved.sex !== expectSex) {
        outcomes.push({ field, outcome: 'sex_incompatible' });
        continue;
      }
      if (resolved.animalId === childId) {
        outcomes.push({ field, outcome: 'self_ref' });
        continue;
      }
      const cyc = cycles.get(`${childId}|${resolved.animalId}`);
      if (cyc === 'cycle' || cyc === 'cycle_check_limit') {
        outcomes.push({ field, outcome: cyc });
        continue;
      }
      if (field === 'dam') damId = resolved.animalId;
      else sireId = resolved.animalId;
      outcomes.push({ field, outcome: 'linked' });
    }
    return { outcomes, damId, sireId };
  }

  /**
   * Escribe el/los vínculo(s) de un animal ya validado (dam_id/sire_id), versiona
   * los campos cambiados con HLC de servidor en sync_row_state (MERGE con las
   * versiones existentes) y devuelve el `syncOp`. Si nada cambia, no devuelve
   * syncOp (evita changeset vacío). Se invoca dentro de la tx del chunk (P-d.2).
   */
  async applyGenealogyLink(q: Q, childId: string, damId?: string, sireId?: string): Promise<{ syncOp?: PutOp }> {
    const t = this.db.tenant;
    // Diff-aware: solo se escribe/versiona/propaga lo que REALMENTE cambia (idempotente
    // ante reproceso; nunca un changeset por un vínculo ya presente).
    const current = await q.one<{ dam_id: string | null; sire_id: string | null }>(
      `SELECT dam_id, sire_id FROM animals WHERE id = $1 AND tenant_id = $2`,
      [childId, t],
    );
    const fields: Record<string, unknown> = {};
    if (damId && current?.dam_id !== damId) fields.dam_id = damId;
    if (sireId && current?.sire_id !== sireId) fields.sire_id = sireId;
    const cols = Object.keys(fields);
    if (!cols.length) return {};

    const sets = cols.map((c, i) => `"${c}" = $${i + 3}`).join(', ');
    await q.query(`UPDATE animals SET ${sets}, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      childId,
      t,
      ...cols.map((c) => fields[c]),
    ]);

    const hlc = this.serverClock.tick();
    const existing = (await this.versions.read(q, 'animals', childId)) ?? {};
    const merged = { ...existing, ...Object.fromEntries(cols.map((c) => [c, hlc])) };
    await this.versions.write(q, 'animals', childId, merged);

    return { syncOp: { kind: 'put', table: 'animals', rowId: childId, fields, hlc } };
  }
}
