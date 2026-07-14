import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const STATUSES = ['planned', 'growing', 'harvested', 'failed'];
/** Transiciones permitidas del ciclo de un cultivo. */
const TRANSITIONS: Record<string, string[]> = {
  planned: ['growing', 'failed'],
  growing: ['harvested', 'failed'],
  harvested: [],
  failed: [],
};

/**
 * Agricultura — cultivos (AG-1): `crops` sobre un paddock, con estados planned→growing→harvested/failed.
 * Todo por tenant (RLS); baja lógica por `deleted_at`. Las labores (consumo de insumos) y cosechas
 * (rinde) llegan en AG-2.
 */
@Injectable()
export class CropsService {
  constructor(private readonly db: DbService) {}

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND c.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT c.id, c.paddock_id, p.name AS paddock_name, c.crop_type, c.variety, c.planting_date, c.expected_harvest_date,
              c.area_ha::float AS area_ha, c.status
       FROM crops c JOIN paddocks p ON p.id = c.paddock_id
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL${filter} ORDER BY c.planting_date DESC NULLS LAST, c.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const crop = await this.db.one(
      `SELECT c.id, c.paddock_id, p.name AS paddock_name, c.crop_type, c.variety, c.planting_date, c.expected_harvest_date,
              c.area_ha::float AS area_ha, c.status
       FROM crops c JOIN paddocks p ON p.id = c.paddock_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!crop) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return crop;
  }

  async create(body: any) {
    const cropType = String(body?.crop_type ?? '').trim();
    if (!cropType) throw new BadRequestException({ code: 'agriculture.missing_crop_type', title: 'crop_type es obligatorio' });
    await this.requirePaddock(body?.paddock_id);
    return this.db.one(
      `INSERT INTO crops (tenant_id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8)
       RETURNING id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha::float AS area_ha, status`,
      [this.db.tenant, body.paddock_id, cropType, body?.variety ?? null, body?.planting_date ?? null, body?.expected_harvest_date ?? null, body?.area_ha ?? null, this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.crop_type === 'string') {
      const c = body.crop_type.trim();
      if (!c) throw new BadRequestException({ code: 'agriculture.missing_crop_type', title: 'crop_type no puede ser vacío' });
      set('crop_type', c);
    }
    if (body?.paddock_id !== undefined) {
      await this.requirePaddock(body.paddock_id);
      set('paddock_id', body.paddock_id);
    }
    for (const f of ['variety', 'planting_date', 'expected_harvest_date', 'area_ha'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'agriculture.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE crops SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha::float AS area_ha, status`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return row;
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'agriculture.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const crop = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM crops WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!crop) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    if (crop.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[crop.status]?.includes(next)) throw new ConflictException({ code: 'agriculture.invalid_transition', title: `No se puede pasar de '${crop.status}' a '${next}'` });
    await this.db.query(`UPDATE crops SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE crops SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return { id, deleted: true };
  }

  private async requirePaddock(id: string | undefined) {
    if (!id) throw new BadRequestException({ code: 'agriculture.missing_paddock', title: 'paddock_id es obligatorio' });
    const p = await this.db.one<{ id: string }>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'agriculture.paddock_not_found', title: 'Potrero no encontrado' });
  }
}
