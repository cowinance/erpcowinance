import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { parseCsv } from './csv';
import { suggestMapping, DuplicateHeadersError } from './mapping';
import type { AnimalImportField } from '../herd/animal-import-descriptor';

export const MAX_IMPORT_ROWS = 5000;

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

/** Rethrow de errores con `code` de dominio (parseCsv / mapping) como 400. */
function asDomain400(e: unknown): never {
  if (e instanceof Error && 'code' in e) {
    throw new BadRequestException({ code: (e as { code: string }).code, title: e.message });
  }
  throw e;
}

@Injectable()
export class ImportService {
  constructor(private readonly db: DbService) {}

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
}
