import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const TYPES = ['tractor', 'harvester', 'truck', 'atv', 'mixer', 'implement', 'other'];
const STATUSES = ['active', 'maintenance', 'retired'];
/** Transiciones permitidas del estado de una máquina. */
const TRANSITIONS: Record<string, string[]> = {
  active: ['maintenance', 'retired'],
  maintenance: ['active', 'retired'],
  retired: [],
};

/**
 * Maquinaria — maestro (MQ-1): `machinery` por tenant/finca, con estados active/maintenance/retired.
 * Baja lógica por `deleted_at`. Sobre este maestro cuelgan mantenimiento, combustible y horas (MQ-2),
 * y lo referencia `crop_operations.machinery_id` (Agricultura).
 */
@Injectable()
export class MachineryService {
  constructor(private readonly db: DbService) {}

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND status = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status
       FROM machinery WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY (status='active') DESC, name`,
      params,
    );
  }

  async get(id: string) {
    const m = await this.db.one(
      `SELECT id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, device_id, status
       FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!m) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return m;
  }

  async create(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'machinery.missing_name', title: 'name es obligatorio' });
    if (body?.type != null && !TYPES.includes(body.type)) throw new BadRequestException({ code: 'machinery.invalid_type', title: `type inválido (${TYPES.join('|')})` });
    const farm = body?.farm_id ?? (await this.db.defaultFarm());
    if (!farm) throw new BadRequestException({ code: 'machinery.no_farm', title: 'No hay finca para la máquina' });
    return this.db.one(
      `INSERT INTO machinery (tenant_id, farm_id, name, type, make, model, year, plate, engine_hours, odometer_km, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
       RETURNING id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status`,
      [this.db.tenant, farm, name, body?.type ?? null, body?.make ?? null, body?.model ?? null, body?.year ?? null, body?.plate ?? null, body?.engine_hours ?? null, body?.odometer_km ?? null, this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.name === 'string') {
      const n = body.name.trim();
      if (!n) throw new BadRequestException({ code: 'machinery.missing_name', title: 'name no puede ser vacío' });
      set('name', n);
    }
    if (body?.type !== undefined) {
      if (body.type != null && !TYPES.includes(body.type)) throw new BadRequestException({ code: 'machinery.invalid_type', title: 'type inválido' });
      set('type', body.type ?? null);
    }
    for (const f of ['make', 'model', 'year', 'plate', 'engine_hours', 'odometer_km'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'machinery.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE machinery SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return row;
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'machinery.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const m = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!m) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    if (m.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[m.status]?.includes(next)) throw new ConflictException({ code: 'machinery.invalid_transition', title: `No se puede pasar de '${m.status}' a '${next}'` });
    await this.db.query(`UPDATE machinery SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE machinery SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return { id, deleted: true };
  }
}
