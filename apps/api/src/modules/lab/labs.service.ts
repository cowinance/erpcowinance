import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const LAB_TYPES = ['genetics', 'pathology', 'milk', 'soil', 'serology', 'other'];

/**
 * Laboratorio (LAB-1) — maestro de laboratorios por tenant. Un laboratorio tiene un tipo
 * (genetics/pathology/milk/soil/serology/other) y datos de contacto (jsonb). Sobre este maestro se
 * envían muestras. Baja lógica por `deleted_at`.
 */
@Injectable()
export class LabsService {
  constructor(private readonly db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT id, name, type, contact FROM labs WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name`,
      [this.db.tenant],
    );
  }

  async get(id: string) {
    const l = await this.db.one(`SELECT id, name, type, contact FROM labs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!l) throw new NotFoundException({ code: 'lab.lab_not_found', title: 'Laboratorio no encontrado' });
    return l;
  }

  async create(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'lab.missing_name', title: 'name es obligatorio' });
    this.assertType(body?.type);
    return this.db.one(
      `INSERT INTO labs (tenant_id, name, type, contact, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, type, contact`,
      [this.db.tenant, name, body?.type ?? null, body?.contact ?? null, this.db.user],
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
      if (!n) throw new BadRequestException({ code: 'lab.missing_name', title: 'name no puede ser vacío' });
      set('name', n);
    }
    if (body?.type !== undefined) {
      this.assertType(body.type);
      set('type', body.type ?? null);
    }
    if (body?.contact !== undefined) set('contact', body.contact ?? null);
    if (!sets.length) throw new BadRequestException({ code: 'lab.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE labs SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, name, type, contact`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'lab.lab_not_found', title: 'Laboratorio no encontrado' });
    return row;
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE labs SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'lab.lab_not_found', title: 'Laboratorio no encontrado' });
    return { id, deleted: true };
  }

  private assertType(type: unknown) {
    if (type != null && !LAB_TYPES.includes(String(type))) {
      throw new BadRequestException({ code: 'lab.invalid_type', title: `type inválido (${LAB_TYPES.join('|')})` });
    }
  }
}
