import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { parseCsv } from './csv';
import { suggestMapping, DuplicateHeadersError } from './mapping';
import { ANIMAL_IMPORT_DESCRIPTOR, REQUIRED_ANIMAL_IMPORT_FIELDS, type AnimalImportField } from '../herd/animal-import-descriptor';
import { AnimalWriteService, type RawAnimalRow, type RowError } from '../herd/animal-write.service';

export const MAX_IMPORT_ROWS = 5000;
const ROWS_PAGE_DEFAULT = 100;
const ROWS_PAGE_MAX = 500;
const VALID_IMPORT_FIELDS = new Set<string>(ANIMAL_IMPORT_DESCRIPTOR.fields.map((f) => f.field));
const EDITABLE_STATES = new Set(['uploaded', 'mapped', 'previewed']);

export interface ImportBatchDto {
  id: string;
  entity_type: string;
  status: string;
  source_filename: string | null;
  total_rows: number;
  created_count: number;
  skipped_count: number;
  invalid_count: number;
  error_count: number;
  reconcile_mode: string;
  mapping: Partial<Record<AnimalImportField, string>>;
  created_at: string;
  updated_at: string;
}

export interface ImportRowDto {
  id: string;
  row_number: number;
  raw: Record<string, string>;
  status: string;
  skip_reason: string | null;
  errors: unknown;
  warnings: unknown;
  resulting_entity_id: string | null;
  processed_at: string | null;
}

/** Cursor de paginación de filas: opaco sobre `row_number` (clave monotónica por batch). */
function encodeCursor(rowNumber: number): string {
  return Buffer.from(String(rowNumber)).toString('base64url');
}
function decodeCursor(cursor: string): number {
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException({ code: 'pagination.invalid_cursor', title: 'Cursor inválido' });
  return n;
}

/** Rethrow de errores con `code` de dominio (parseCsv / mapping) como 400. */
function asDomain400(e: unknown): never {
  if (e instanceof Error && 'code' in e) {
    throw new BadRequestException({ code: (e as { code: string }).code, title: e.message });
  }
  throw e;
}

export interface PreviewVerdict {
  row_number: number;
  verdict: 'valid' | 'invalid' | 'duplicate';
  errors?: RowError[];
  reason?: string;
}
export interface PreviewDto {
  counts: { total: number; valid: number; invalid: number; duplicate: number };
  sample: PreviewVerdict[];
}
const PREVIEW_SAMPLE_SIZE = 20;

/** Arma un RawAnimalRow desde la fila cruda y el mapping (campo canónico → encabezado). */
function buildRawRow(raw: Record<string, string>, mapping: Partial<Record<AnimalImportField, string>>): RawAnimalRow {
  const out: RawAnimalRow = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (header) (out as Record<string, unknown>)[field] = raw[header];
  }
  return out;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly db: DbService,
    private readonly animalWrite: AnimalWriteService,
  ) {}

  /**
   * Crea un batch de importación desde un CSV (P2 3.3b): valida entity_type,
   * parsea (validación por parser, no MIME), aplica el mapping sugerido y
   * persiste batch + filas en UNA sola transacción (rollback total si algo falla).
   * Estado inicial `uploaded`. No valida obligatorios (3.4) ni crea animales.
   */
  async createFromCsv(entityType: string, filename: string | null, content: string): Promise<ImportBatchDto & { headers: string[] }> {
    if (entityType !== 'animal') {
      throw new BadRequestException({ code: 'import.invalid_entity_type', title: "entity_type debe ser 'animal'" });
    }

    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(content);
    } catch (e) {
      asDomain400(e); // CsvParseError (import.csv_parse_error) / CsvIrregularRowError (import.irregular_row)
    }

    if (parsed!.rows.length === 0) {
      throw new BadRequestException({ code: 'import.empty_file', title: 'El CSV no tiene filas de datos' });
    }
    if (parsed!.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({ code: 'import.too_many_rows', title: `Máximo ${MAX_IMPORT_ROWS} filas (${parsed!.rows.length})` });
    }

    let mapping: Partial<Record<AnimalImportField, string>>;
    try {
      mapping = suggestMapping(parsed!.headers);
    } catch (e) {
      if (e instanceof DuplicateHeadersError) throw new BadRequestException({ code: e.code, title: e.message });
      throw e;
    }

    const tenant = this.db.tenant;
    const user = this.db.user;
    return this.db.tx(async (q) => {
      const batch = await q.one<ImportBatchDto>(
        `INSERT INTO import_batches (tenant_id, entity_type, source_filename, mapping, status, total_rows, created_by)
         VALUES ($1,'animal',$2,$3,'uploaded',$4,$5)
         RETURNING id, entity_type, status, source_filename, total_rows, created_count, skipped_count,
                   invalid_count, error_count, reconcile_mode, mapping, created_at, updated_at`,
        [tenant, filename, JSON.stringify(mapping), parsed!.rows.length, user],
      );

      // Bulk insert de filas en una sola sentencia (UNNEST → params fijos, sin límite por nº de filas).
      const rowNumbers = parsed!.rows.map((_, i) => i + 1);
      const raws = parsed!.rows.map((r) => JSON.stringify(r));
      await q.query(
        `INSERT INTO import_rows (tenant_id, batch_id, row_number, raw)
         SELECT $1::uuid, $2::uuid, rn, raw::jsonb
         FROM unnest($3::int[], $4::jsonb[]) AS t(rn, raw)`,
        [tenant, batch!.id, rowNumbers, raws],
      );

      return { ...batch!, headers: parsed!.headers };
    });
  }

  /** GET /v1/imports/:id — batch del tenant actual (404 si no existe o es ajeno). */
  async getBatch(id: string): Promise<ImportBatchDto> {
    const batch = await this.db.one<ImportBatchDto>(
      `SELECT id, entity_type, status, source_filename, total_rows, created_count, skipped_count,
              invalid_count, error_count, reconcile_mode, mapping, created_at, updated_at
       FROM import_batches WHERE id = $1 AND tenant_id = $2`,
      [id, this.db.tenant],
    );
    if (!batch) throw new NotFoundException({ code: 'import.batch_not_found', title: 'Import no encontrado' });
    return batch;
  }

  /** GET /v1/imports/:id/rows — filas del batch, paginadas por cursor (row_number). */
  async listRows(id: string, cursor?: string, limit?: number): Promise<{ data: ImportRowDto[]; next_cursor: string | null }> {
    await this.getBatch(id); // 404 si el batch no es del tenant (evita filtrar existencia cross-tenant)
    const take = Math.min(Math.max(limit ?? ROWS_PAGE_DEFAULT, 1), ROWS_PAGE_MAX);
    const after = cursor ? decodeCursor(cursor) : 0;
    const rows = await this.db.query<ImportRowDto>(
      `SELECT id, row_number, raw, status, skip_reason, errors, warnings, resulting_entity_id, processed_at
       FROM import_rows
       WHERE tenant_id = $1 AND batch_id = $2 AND row_number > $3
       ORDER BY row_number LIMIT $4`,
      [this.db.tenant, id, after, take + 1],
    );
    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    return { data, next_cursor: hasMore ? encodeCursor(data[data.length - 1].row_number) : null };
  }

  /**
   * PUT /v1/imports/:id/mapping — reemplaza el mapping del batch (campo canónico →
   * encabezado). Valida forma (keys de campos válidos, valores string no vacíos) y
   * obligatorios presentes (tag/sex/category_code). La existencia real del header la
   * revela el preview (3.5). Deja el batch en `mapped`. No valida contra los headers
   * del CSV (no se persisten) — ver microanálisis 3.4.
   */
  async updateMapping(id: string, mapping: unknown): Promise<ImportBatchDto> {
    const batch = await this.getBatch(id); // 404 si es ajeno o no existe
    if (!EDITABLE_STATES.has(batch.status)) {
      throw new BadRequestException({ code: 'import.batch_not_editable', title: `El import en estado '${batch.status}' no admite cambios de mapping` });
    }
    if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
      throw new BadRequestException({ code: 'import.invalid_mapping', title: 'mapping debe ser un objeto { campo: encabezado }' });
    }
    const entries = Object.entries(mapping as Record<string, unknown>);
    for (const [field, header] of entries) {
      if (!VALID_IMPORT_FIELDS.has(field)) {
        throw new BadRequestException({ code: 'import.invalid_mapping', title: `Campo desconocido en el mapping: '${field}'` });
      }
      if (typeof header !== 'string' || header.trim() === '') {
        throw new BadRequestException({ code: 'import.invalid_mapping', title: `El encabezado de '${field}' debe ser un texto no vacío` });
      }
    }
    const mapped = new Set(entries.map(([f]) => f));
    const missing = REQUIRED_ANIMAL_IMPORT_FIELDS.filter((f) => !mapped.has(f));
    if (missing.length) {
      throw new BadRequestException({ code: 'import.mapping_missing_required', title: `Faltan campos obligatorios en el mapping: ${missing.join(', ')}` });
    }

    const clean: Partial<Record<AnimalImportField, string>> = {};
    for (const [field, header] of entries) clean[field as AnimalImportField] = header as string;

    const updated = await this.db.one<ImportBatchDto>(
      `UPDATE import_batches SET mapping = $3, status = 'mapped', updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, entity_type, status, source_filename, total_rows, created_count, skipped_count,
                 invalid_count, error_count, reconcile_mode, mapping, created_at, updated_at`,
      [id, this.db.tenant, JSON.stringify(clean)],
    );
    if (!updated) throw new NotFoundException({ code: 'import.batch_not_found', title: 'Import no encontrado' });
    return updated;
  }

  /**
   * POST /v1/imports/:id/preview (P2 3.5) — validación por fila SIN escribir
   * animales ni estados terminales. Reutiliza Herd: `normalizeAndValidate` (pura)
   * + `loadAnimalImportValidationContext` (2 queries, batch-context, sin N+1).
   * Es una estimación; el commit revalida (la base puede cambiar). Deja `previewed`.
   */
  async preview(id: string): Promise<PreviewDto> {
    const batch = await this.getBatch(id);
    if (!EDITABLE_STATES.has(batch.status)) {
      throw new BadRequestException({ code: 'import.batch_not_editable', title: `El import en estado '${batch.status}' no admite preview` });
    }
    const mapping = (batch.mapping ?? {}) as Partial<Record<AnimalImportField, string>>;
    const missing = REQUIRED_ANIMAL_IMPORT_FIELDS.filter((f) => !mapping[f]);
    if (missing.length) {
      throw new BadRequestException({ code: 'import.mapping_missing_required', title: `Faltan campos obligatorios en el mapping: ${missing.join(', ')}` });
    }

    const rows = await this.db.query<{ row_number: number; raw: Record<string, string> }>(
      `SELECT row_number, raw FROM import_rows WHERE tenant_id = $1 AND batch_id = $2 ORDER BY row_number`,
      [this.db.tenant, id],
    );

    // 1) Validación PURA por fila + recolección de categorías/caravanas únicas.
    const evaluated = rows.map((r) => ({ row_number: r.row_number, nv: this.animalWrite.normalizeAndValidate(buildRawRow(r.raw, mapping)) }));
    const categoryCodes: string[] = [];
    const tags: string[] = [];
    for (const e of evaluated) {
      if (e.nv.ok) {
        categoryCodes.push(e.nv.input.categoryCode);
        tags.push(e.nv.input.tag);
      }
    }

    // 2) Contexto batch (2 queries).
    const ctx = await this.animalWrite.loadAnimalImportValidationContext({ categoryCodes, tags });

    // 3) Veredicto por fila con el contexto + duplicados intra-archivo.
    const seen = new Set<string>();
    const counts = { total: rows.length, valid: 0, invalid: 0, duplicate: 0 };
    const sample: PreviewVerdict[] = [];
    for (const e of evaluated) {
      let v: PreviewVerdict;
      if (!e.nv.ok) {
        v = { row_number: e.row_number, verdict: 'invalid', errors: e.nv.errors };
        counts.invalid++;
      } else if (!ctx.existingCategoryCodes.has(e.nv.input.categoryCode)) {
        v = { row_number: e.row_number, verdict: 'invalid', errors: [{ field: 'category_code', code: 'not_found', message: 'Categoría inexistente' }] };
        counts.invalid++;
      } else if (ctx.activeTags.has(e.nv.input.tag) || seen.has(e.nv.input.tag)) {
        v = { row_number: e.row_number, verdict: 'duplicate', reason: ctx.activeTags.has(e.nv.input.tag) ? 'caravana activa existente' : 'caravana duplicada en el archivo' };
        counts.duplicate++;
      } else {
        seen.add(e.nv.input.tag);
        v = { row_number: e.row_number, verdict: 'valid' };
        counts.valid++;
      }
      if (sample.length < PREVIEW_SAMPLE_SIZE) sample.push(v);
    }

    await this.db.query(`UPDATE import_batches SET status = 'previewed', updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant]);
    return { counts, sample };
  }
}
