import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InvalidDocumentError, validateDocumentInput } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { signFileToken } from '../../common/file-token';
import { FILE_STORAGE, fileKey, type FileStorage } from '../../application/ports/file-storage.port';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB por documento
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/**
 * Documentos, archivos y media (A6) — el DMS del ERP. Gestiona documentos formales (tabla `documents`)
 * que envuelven un archivo (PDF/imagen) y agregan tipo, emisor, vigencia y vencimiento, con enlace
 * polimórfico opcional a cualquier entidad. Reusa el almacenamiento de archivos del módulo media
 * (puerto `FILE_STORAGE` + dedup por checksum + servido por token firmado en /files/:id/content). Deriva el estado de
 * caducidad (vencido / por vencer) con CURRENT_DATE — la fuente del indicador «documentos por vencer».
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private ref(fileId: string, mime: string) {
    return { file_id: fileId, mime, token: signFileToken(fileId, this.db.tenant, mime) };
  }

  /** Persiste el archivo (data URL base64) reutilizando por checksum; devuelve id + mime. */
  private async storeFile(dataUrl: unknown): Promise<{ id: string; mime: string }> {
    const t = this.db.tenant;
    const m = String(dataUrl ?? '').match(DATA_URL);
    if (!m) throw new BadRequestException({ code: 'documents.invalid_data', title: 'Se espera un archivo en data URL base64' });
    const mime = m[1].toLowerCase();
    if (!ALLOWED.has(mime)) throw new BadRequestException({ code: 'documents.bad_mime', title: 'Solo se admiten PDF o imágenes (PNG/JPG/WebP)' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      throw new BadRequestException({ code: 'documents.size', title: `El archivo debe pesar entre 1 byte y ${MAX_BYTES / 1024 / 1024} MB` });
    }
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.db.one<{ id: string; mime_type: string }>(
      `SELECT id, mime_type FROM files WHERE tenant_id=$1 AND checksum=$2 AND deleted_at IS NULL LIMIT 1`,
      [t, checksum],
    );
    if (existing) return { id: existing.id, mime: existing.mime_type };
    const mediaType = mime === 'application/pdf' ? 'document' : 'image';
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    const file = await this.db.one<{ id: string }>(
      `INSERT INTO files (tenant_id, bucket_key, file_name, mime_type, media_type, size_bytes, checksum, sync_status, uploaded_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'synced',$8,$8) RETURNING id`,
      [t, `uploads/${t}`, `doc-${Date.now()}.${ext}`, mime, mediaType, buffer.length, checksum, this.db.user],
    );
    await this.storage.put(fileKey(t, file!.id), buffer, mime);
    return { id: file!.id, mime };
  }

  async create(body: any) {
    const input = (() => {
      try {
        return validateDocumentInput(body);
      } catch (e) {
        if (e instanceof InvalidDocumentError) throw new BadRequestException({ code: 'documents.invalid', title: e.reason });
        throw e;
      }
    })();
    const file = await this.storeFile(body?.data_url);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO documents (tenant_id, file_id, type, title, issued_by, issue_date, expiry_date, entity_type, entity_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [this.db.tenant, file.id, input.type, input.title, input.issuedBy, input.issueDate, input.expiryDate, input.entityType, input.entityId, this.db.user],
    );
    return this.get(row!.id);
  }

  async get(id: string) {
    const row = await this.db.one<any>(`${this.selectSql()} AND d.id=$2`, [this.db.tenant, id]);
    if (!row) throw new NotFoundException({ code: 'documents.not_found', title: 'Documento no encontrado' });
    return this.decorate(row);
  }

  /** Lista con filtros: type, expiring=true (por vencer o vencidos) y enlace (entity_type/entity_id). */
  async list(opts: { type?: string; expiring?: string; entity_type?: string; entity_id?: string } = {}) {
    const where: string[] = [];
    const args: any[] = [this.db.tenant];
    if (opts.type) {
      args.push(opts.type);
      where.push(`d.type=$${args.length}`);
    }
    if (opts.entity_type && opts.entity_id) {
      args.push(opts.entity_type, opts.entity_id);
      where.push(`d.entity_type=$${args.length - 1} AND d.entity_id=$${args.length}`);
    }
    if (opts.expiring === 'true') where.push(`d.expiry_date IS NOT NULL AND d.expiry_date <= CURRENT_DATE + 30`);
    const rows = await this.db.query<any>(`${this.selectSql()}${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY d.expiry_date NULLS LAST, d.created_at DESC`, args);
    return rows.map((r) => this.decorate(r));
  }

  /** Indicador del DMS: total, por vencer (≤30 días) y vencidos. */
  async summary() {
    const [row] = await this.db.query<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int AS expired,
              count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30)::int AS expiring_soon
       FROM documents WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    return row;
  }

  async remove(id: string) {
    const res = await this.db.query(`UPDATE documents SET deleted_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (res.length === 0) throw new NotFoundException({ code: 'documents.not_found', title: 'Documento no encontrado' });
    return { id, deleted: true };
  }

  private selectSql() {
    return `SELECT d.id, d.type, d.title, d.issued_by, d.issue_date, d.expiry_date, d.entity_type, d.entity_id, d.created_at,
              d.file_id, f.mime_type, f.file_name, f.size_bytes,
              (d.expiry_date IS NOT NULL AND d.expiry_date < CURRENT_DATE) AS is_expired,
              CASE WHEN d.expiry_date IS NULL THEN NULL ELSE (d.expiry_date - CURRENT_DATE) END AS days_to_expiry
       FROM documents d JOIN files f ON f.id = d.file_id AND f.deleted_at IS NULL
       WHERE d.tenant_id=$1 AND d.deleted_at IS NULL`;
  }

  private decorate(r: any) {
    const { mime_type, ...rest } = r;
    return { ...rest, file: this.ref(r.file_id, mime_type) };
  }
}
