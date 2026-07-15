import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { computeGrazingMetrics } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Pastoreo (PG-1): `grazing_records` — un lote entra a un potrero y sale (rotación). Reglas de negocio:
 * un potrero ocupado no admite otra entrada, y un lote no puede pastorear dos potreros a la vez (ambos
 * → 409). Métricas (días, forraje consumido, abierto) DERIVADAS con `computeGrazingMetrics`. Por tenant.
 */
@Injectable()
export class GrazingService {
  constructor(private readonly db: DbService) {}

  async list(paddockId?: string, lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (paddockId) {
      params.push(paddockId);
      filter += ` AND g.paddock_id = $${params.length}`;
    }
    if (lotId) {
      params.push(lotId);
      filter += ` AND g.lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(
      `SELECT g.id, g.paddock_id, p.name AS paddock_name, g.lot_id, l.name AS lot_name, g.entry_date::text AS entry_date, g.exit_date::text AS exit_date,
              g.pre_grazing_kg_dm_ha::float AS pre_grazing_kg_dm_ha, g.post_grazing_kg_dm_ha::float AS post_grazing_kg_dm_ha
       FROM grazing_records g JOIN paddocks p ON p.id = g.paddock_id JOIN lots l ON l.id = g.lot_id
       WHERE g.tenant_id=$1 AND g.deleted_at IS NULL${filter} ORDER BY g.entry_date DESC, g.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => ({ ...r, ...computeGrazingMetrics(r.entry_date, r.exit_date, r.pre_grazing_kg_dm_ha, r.post_grazing_kg_dm_ha) }));
  }

  async get(id: string) {
    const r = await this.db.one<any>(
      `SELECT g.id, g.paddock_id, p.name AS paddock_name, g.lot_id, l.name AS lot_name, g.entry_date::text AS entry_date, g.exit_date::text AS exit_date,
              g.pre_grazing_kg_dm_ha::float AS pre_grazing_kg_dm_ha, g.post_grazing_kg_dm_ha::float AS post_grazing_kg_dm_ha
       FROM grazing_records g JOIN paddocks p ON p.id = g.paddock_id JOIN lots l ON l.id = g.lot_id
       WHERE g.id=$1 AND g.tenant_id=$2 AND g.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!r) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    return { ...r, ...computeGrazingMetrics(r.entry_date, r.exit_date, r.pre_grazing_kg_dm_ha, r.post_grazing_kg_dm_ha) };
  }

  /** Entrada: el lote entra al potrero (nace abierto). Rechaza si el potrero está ocupado o el lote ya pastorea. */
  async enter(body: any) {
    const t = this.db.tenant;
    const paddockId = body?.paddock_id;
    const lotId = body?.lot_id;
    if (!paddockId || !lotId) throw new BadRequestException({ code: 'grazing.missing_fields', title: 'paddock_id y lot_id son obligatorios' });
    await this.requirePaddock(paddockId);
    await this.requireLot(lotId);
    const entryDate = body?.entry_date ?? new Date().toISOString().slice(0, 10);

    const occupied = await this.db.one<{ id: string }>(`SELECT id FROM grazing_records WHERE paddock_id=$1 AND tenant_id=$2 AND exit_date IS NULL AND deleted_at IS NULL`, [paddockId, t]);
    if (occupied) throw new ConflictException({ code: 'grazing.paddock_occupied', title: 'El potrero ya tiene un pastoreo abierto' });
    const grazing = await this.db.one<{ id: string }>(`SELECT id FROM grazing_records WHERE lot_id=$1 AND tenant_id=$2 AND exit_date IS NULL AND deleted_at IS NULL`, [lotId, t]);
    if (grazing) throw new ConflictException({ code: 'grazing.lot_already_grazing', title: 'El lote ya está pastoreando otro potrero' });

    const row = await this.db.one(
      `INSERT INTO grazing_records (tenant_id, paddock_id, lot_id, entry_date, pre_grazing_kg_dm_ha, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [t, paddockId, lotId, entryDate, body?.pre_grazing_kg_dm_ha ?? null, this.db.user],
    );
    return this.get((row as { id: string }).id);
  }

  /** Salida: cierra el pastoreo (libera el potrero). exit_date ≥ entry_date; solo sobre uno abierto. */
  async exit(id: string, body: any) {
    const t = this.db.tenant;
    const g = await this.db.one<{ id: string; entry_date: string; exit_date: string | null }>(`SELECT id, entry_date::text AS entry_date, exit_date::text AS exit_date FROM grazing_records WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!g) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    if (g.exit_date) throw new ConflictException({ code: 'grazing.already_closed', title: 'El pastoreo ya está cerrado' });
    const exitDate = body?.exit_date ?? new Date().toISOString().slice(0, 10);
    if (String(exitDate) < String(g.entry_date)) throw new BadRequestException({ code: 'grazing.invalid_exit', title: 'exit_date no puede ser anterior a entry_date' });
    await this.db.query(`UPDATE grazing_records SET exit_date=$1, post_grazing_kg_dm_ha=$2, updated_at=now() WHERE id=$3 AND tenant_id=$4`, [exitDate, body?.post_grazing_kg_dm_ha ?? null, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE grazing_records SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'grazing.not_found', title: 'Pastoreo no encontrado' });
    return { id, deleted: true };
  }

  private async requirePaddock(id: string) {
    const p = await this.db.one<{ id: string }>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'grazing.paddock_not_found', title: 'Potrero no encontrado' });
  }

  private async requireLot(id: string) {
    const l = await this.db.one<{ id: string }>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!l) throw new NotFoundException({ code: 'grazing.lot_not_found', title: 'Lote no encontrado' });
  }
}
