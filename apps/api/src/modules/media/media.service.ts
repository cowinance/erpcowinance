import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { signFileToken, verifyFileToken } from '../../common/file-token';

const UPLOAD_ROOT = join(process.cwd(), '.data', 'uploads');
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB por imagen
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

@Injectable()
export class MediaService {
  constructor(private readonly db: DbService) {}

  private filePath(tenantId: string, fileId: string) {
    return join(UPLOAD_ROOT, tenantId, fileId);
  }

  /** Metadatos + URL firmada para renderizar el archivo desde el navegador. */
  private toRef(fileId: string, mime: string) {
    return { file_id: fileId, token: signFileToken(fileId, this.db.tenant, mime), mime };
  }

  async uploadAnimalPhoto(animalId: string, body: { data_url?: string; caption?: string; taken_at?: string }) {
    const t = this.db.tenant;
    const animal = await this.db.one<any>(
      `SELECT id, photo_file_id FROM animals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [animalId, t],
    );
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });

    const m = (body?.data_url ?? '').match(DATA_URL);
    if (!m) throw new BadRequestException({ code: 'media.invalid_data', title: 'Se espera una imagen en data URL base64' });
    const mime = m[1].toLowerCase();
    if (!mime.startsWith('image/'))
      throw new BadRequestException({ code: 'media.not_image', title: 'Solo se admiten imágenes' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES)
      throw new BadRequestException({ code: 'media.size', title: `La imagen debe pesar entre 1 byte y ${MAX_BYTES / 1024 / 1024} MB` });

    const checksum = createHash('sha256').update(buffer).digest('hex');

    // Dedupe por checksum dentro del tenant: reutiliza el archivo si ya existe
    let file = await this.db.one<any>(
      `SELECT id, mime_type FROM files WHERE tenant_id = $1 AND checksum = $2 AND deleted_at IS NULL LIMIT 1`,
      [t, checksum],
    );
    if (!file) {
      const ext = mime.split('/')[1];
      file = await this.db.one<any>(
        `INSERT INTO files (tenant_id, bucket_key, file_name, mime_type, media_type, size_bytes, checksum, taken_at, sync_status, uploaded_by, created_by)
         VALUES ($1,$2,$3,$4,'image',$5,$6,$7,'synced',$8,$8) RETURNING id, mime_type`,
        [t, `uploads/${t}`, `foto-${Date.now()}.${ext}`, mime, buffer.length, checksum, body.taken_at ?? null, this.db.user],
      );
      mkdirSync(join(UPLOAD_ROOT, t), { recursive: true });
      writeFileSync(this.filePath(t, file.id), buffer);
    }

    // Vínculo polimórfico con el animal
    await this.db.query(
      `INSERT INTO attachments (tenant_id, file_id, entity_type, entity_id, role, caption, created_by)
       VALUES ($1,$2,'animal',$3,'photo',$4,$5)`,
      [t, file.id, animalId, body.caption ?? null, this.db.user],
    );
    // Primera foto → foto principal
    if (!animal.photo_file_id)
      await this.db.query(`UPDATE animals SET photo_file_id = $2, updated_at = now() WHERE id = $1`, [animalId, file.id]);

    return { ...this.toRef(file.id, file.mime_type), is_primary: !animal.photo_file_id };
  }

  async listAnimalPhotos(animalId: string) {
    const rows = await this.db.query<any>(
      `SELECT at.id AS attachment_id, f.id AS file_id, f.mime_type, f.taken_at, at.caption, at.created_at,
              (f.id = a.photo_file_id) AS is_primary
       FROM attachments at
       JOIN files f ON f.id = at.file_id AND f.deleted_at IS NULL
       JOIN animals a ON a.id = at.entity_id
       WHERE at.tenant_id = $1 AND at.entity_type = 'animal' AND at.entity_id = $2 AND at.role = 'photo' AND at.deleted_at IS NULL
       ORDER BY (f.id = a.photo_file_id) DESC, at.created_at DESC`,
      [this.db.tenant, animalId],
    );
    return rows.map((r) => ({
      attachment_id: r.attachment_id,
      is_primary: r.is_primary,
      caption: r.caption,
      taken_at: r.taken_at,
      created_at: r.created_at,
      ...this.toRef(r.file_id, r.mime_type),
    }));
  }

  async setPrimary(animalId: string, fileId: string) {
    const attached = await this.db.one(
      `SELECT id FROM attachments WHERE tenant_id = $1 AND entity_type = 'animal' AND entity_id = $2 AND file_id = $3 AND deleted_at IS NULL`,
      [this.db.tenant, animalId, fileId],
    );
    if (!attached) throw new NotFoundException({ code: 'media.not_attached', title: 'La foto no pertenece a este animal' });
    await this.db.query(`UPDATE animals SET photo_file_id = $2, updated_at = now() WHERE id = $1 AND tenant_id = $3`, [
      animalId,
      fileId,
      this.db.tenant,
    ]);
    return { ok: true };
  }

  async deletePhoto(animalId: string, fileId: string) {
    const t = this.db.tenant;
    await this.db.query(
      `UPDATE attachments SET deleted_at = now() WHERE tenant_id = $1 AND entity_type = 'animal' AND entity_id = $2 AND file_id = $3 AND deleted_at IS NULL`,
      [t, animalId, fileId],
    );
    // Si era la principal, promover la siguiente foto vigente (o dejar sin foto)
    const animal = await this.db.one<any>(`SELECT photo_file_id FROM animals WHERE id = $1 AND tenant_id = $2`, [animalId, t]);
    if (animal?.photo_file_id === fileId) {
      const next = await this.db.one<any>(
        `SELECT f.id FROM attachments at JOIN files f ON f.id = at.file_id AND f.deleted_at IS NULL
         WHERE at.tenant_id = $1 AND at.entity_type = 'animal' AND at.entity_id = $2 AND at.role = 'photo' AND at.deleted_at IS NULL
         ORDER BY at.created_at DESC LIMIT 1`,
        [t, animalId],
      );
      await this.db.query(`UPDATE animals SET photo_file_id = $2, updated_at = now() WHERE id = $1`, [animalId, next?.id ?? null]);
    }
    return { ok: true };
  }

  /** Servido del archivo (endpoint público, validado por token firmado). */
  serve(fileId: string, token: string): { buffer: Buffer; mime: string } {
    const claims = verifyFileToken(token);
    if (!claims || claims.fid !== fileId)
      throw new BadRequestException({ code: 'media.invalid_token', title: 'Token de archivo inválido o vencido' });
    const path = this.filePath(claims.ten, fileId);
    if (!existsSync(path)) throw new NotFoundException({ code: 'media.file_missing', title: 'Archivo no encontrado' });
    return { buffer: readFileSync(path), mime: claims.mime };
  }
}
