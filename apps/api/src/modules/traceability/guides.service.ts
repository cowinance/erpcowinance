import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const STATUSES = ['issued', 'in_transit', 'completed', 'canceled'];
/** Transiciones permitidas del ciclo de una guía de traslado. */
const TRANSITIONS: Record<string, string[]> = {
  issued: ['in_transit', 'canceled'],
  in_transit: ['completed', 'canceled'],
  completed: [],
  canceled: [],
};

/**
 * Trazabilidad — guías de traslado (T-1): `movement_guides` (origen finca → destino socio, cabezas),
 * con estados issued→in_transit→completed/canceled. Documento por tenant/company; baja lógica por
 * `deleted_at`. Registro por cantidad (`animal_count`); el esquema no tiene detalle por animal.
 */
@Injectable()
export class GuidesService {
  constructor(private readonly db: DbService) {}

  private async companyId(): Promise<string> {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'traceability.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND g.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT g.id, g.guide_number, g.from_farm_id, f.name AS from_farm_name, g.to_partner_id, p.name AS to_partner_name,
              g.issued_at, g.animal_count, g.status
       FROM movement_guides g LEFT JOIN farms f ON f.id = g.from_farm_id LEFT JOIN business_partners p ON p.id = g.to_partner_id
       WHERE g.tenant_id=$1 AND g.deleted_at IS NULL${filter} ORDER BY g.issued_at DESC, g.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const g = await this.db.one(
      `SELECT g.id, g.guide_number, g.from_farm_id, f.name AS from_farm_name, g.to_partner_id, p.name AS to_partner_name,
              g.issued_at, g.animal_count, g.status
       FROM movement_guides g LEFT JOIN farms f ON f.id = g.from_farm_id LEFT JOIN business_partners p ON p.id = g.to_partner_id
       WHERE g.id=$1 AND g.tenant_id=$2 AND g.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!g) throw new NotFoundException({ code: 'traceability.guide_not_found', title: 'Guía no encontrada' });
    return g;
  }

  async create(body: any) {
    const number = String(body?.guide_number ?? '').trim();
    if (!number) throw new BadRequestException({ code: 'traceability.missing_number', title: 'guide_number es obligatorio' });
    const t = this.db.tenant;
    const farmId = body?.from_farm_id ?? (await this.db.defaultFarm());
    await this.requireFarm(farmId);
    await this.requirePartner(body?.to_partner_id);
    const issuedAt = body?.issued_at ?? new Date().toISOString().slice(0, 10);
    const animalCount = body?.animal_count != null ? Number(body.animal_count) : null;
    if (animalCount != null && (!Number.isInteger(animalCount) || animalCount < 0)) throw new BadRequestException({ code: 'traceability.invalid_count', title: 'animal_count debe ser un entero ≥ 0' });
    return this.db.one(
      `INSERT INTO movement_guides (tenant_id, company_id, guide_number, from_farm_id, to_partner_id, issued_at, animal_count, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',$8) RETURNING id, guide_number, from_farm_id, to_partner_id, issued_at, animal_count, status`,
      [t, await this.companyId(), number, farmId, body?.to_partner_id ?? null, issuedAt, animalCount, this.db.user],
    );
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'traceability.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const g = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM movement_guides WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!g) throw new NotFoundException({ code: 'traceability.guide_not_found', title: 'Guía no encontrada' });
    if (g.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[g.status]?.includes(next)) throw new ConflictException({ code: 'traceability.invalid_transition', title: `No se puede pasar de '${g.status}' a '${next}'` });
    await this.db.query(`UPDATE movement_guides SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE movement_guides SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'traceability.guide_not_found', title: 'Guía no encontrada' });
    return { id, deleted: true };
  }

  private async requireFarm(id: string) {
    const f = await this.db.one<{ id: string }>(`SELECT id FROM farms WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!f) throw new NotFoundException({ code: 'traceability.farm_not_found', title: 'Finca no encontrada' });
  }

  private async requirePartner(id: string | null | undefined) {
    if (!id) return;
    const p = await this.db.one<{ id: string }>(`SELECT id FROM business_partners WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'traceability.partner_not_found', title: 'Socio destino no encontrado' });
  }
}
