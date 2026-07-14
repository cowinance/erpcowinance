import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Tablas validables por tipo de entidad. `product` se difiere (sin maestro de producto claro). */
const ENTITY_TABLES: Record<string, string> = { farm: 'farms', animal: 'animals', lot: 'lots' };
const STATUSES = ['active', 'suspended', 'revoked']; // `expired` es DERIVADO de valid_until, no manual.
const TRANSITIONS: Record<string, string[]> = {
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
};

/**
 * Trazabilidad — certificaciones (T-2): `certifications` polimórfica (farm/animal/lot) bajo un
 * `scheme`, con emisor, vigencia y estado (active/suspended/revoked). El vencimiento es DERIVADO de
 * `valid_until` (flag `is_expired`), no un estado que haya que actualizar por cron. Por tenant.
 */
@Injectable()
export class CertificationsService {
  constructor(private readonly db: DbService) {}

  async list(entityType?: string, entityId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (entityType && ENTITY_TABLES[entityType]) {
      params.push(entityType);
      filter += ` AND entity_type = $${params.length}`;
    }
    if (entityId) {
      params.push(entityId);
      filter += ` AND entity_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status,
              (valid_until IS NOT NULL AND valid_until < CURRENT_DATE) AS is_expired
       FROM certifications WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY valid_until DESC NULLS LAST, created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const c = await this.db.one(
      `SELECT id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status,
              (valid_until IS NOT NULL AND valid_until < CURRENT_DATE) AS is_expired
       FROM certifications WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!c) throw new NotFoundException({ code: 'traceability.certification_not_found', title: 'Certificación no encontrada' });
    return c;
  }

  async create(body: any) {
    const entityType = body?.entity_type;
    if (!ENTITY_TABLES[entityType]) throw new BadRequestException({ code: 'traceability.invalid_entity_type', title: `entity_type inválido (${Object.keys(ENTITY_TABLES).join('|')}; 'product' diferido)` });
    const entityId = body?.entity_id;
    if (!entityId) throw new BadRequestException({ code: 'traceability.missing_entity', title: 'entity_id es obligatorio' });
    await this.requireEntity(entityType, entityId);
    const scheme = String(body?.scheme ?? '').trim();
    if (!scheme) throw new BadRequestException({ code: 'traceability.missing_scheme', title: 'scheme es obligatorio' });
    if (body?.valid_from && body?.valid_until && String(body.valid_until) < String(body.valid_from)) {
      throw new BadRequestException({ code: 'traceability.invalid_validity', title: 'valid_until no puede ser anterior a valid_from' });
    }
    return this.db.one(
      `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
       RETURNING id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status,
                 (valid_until IS NOT NULL AND valid_until < CURRENT_DATE) AS is_expired`,
      [this.db.tenant, entityType, entityId, scheme, body?.issuer ?? null, body?.valid_from ?? null, body?.valid_until ?? null, this.db.user],
    );
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'traceability.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const c = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM certifications WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!c) throw new NotFoundException({ code: 'traceability.certification_not_found', title: 'Certificación no encontrada' });
    if (c.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[c.status]?.includes(next)) throw new ConflictException({ code: 'traceability.invalid_transition', title: `No se puede pasar de '${c.status}' a '${next}'` });
    await this.db.query(`UPDATE certifications SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE certifications SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'traceability.certification_not_found', title: 'Certificación no encontrada' });
    return { id, deleted: true };
  }

  /** Valida que la entidad certificada exista y sea del tenant, según su tipo. */
  private async requireEntity(entityType: string, entityId: string) {
    const table = ENTITY_TABLES[entityType];
    const r = await this.db.one<{ id: string }>(`SELECT id FROM ${table} WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [entityId, this.db.tenant]);
    if (!r) throw new NotFoundException({ code: 'traceability.entity_not_found', title: `${entityType} no encontrado` });
  }
}
