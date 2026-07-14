import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

const ADJUST_REASONS = ['acquisition', 'transfer', 'adjustment', 'loss'];
const METHODS = ['in_vivo', 'ivf'];

/**
 * Genética — embriones (G-2b): `embryos` (inventario con `straws_available`). Simétrico a las pajuelas:
 * el saldo se muta SOLO por `adjustStraws` (sin negativo); en la transferencia embrionaria (repro) se
 * consume vía `applyStrawsDelta`. Todo por tenant; baja lógica por `deleted_at`.
 */
@Injectable()
export class EmbryosService {
  constructor(private readonly db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, straws_available, tank_id, created_date
       FROM embryos WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY straws_available DESC, created_date DESC NULLS LAST`,
      [this.db.tenant],
    );
  }

  async get(id: string) {
    const e = await this.db.one(
      `SELECT id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, straws_available, tank_id, created_date
       FROM embryos WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!e) throw new NotFoundException({ code: 'genetics.embryo_not_found', title: 'Embrión no encontrado' });
    return e;
  }

  async create(body: any) {
    if (body?.production_method != null && !METHODS.includes(body.production_method)) throw new BadRequestException({ code: 'genetics.invalid_method', title: `production_method inválido (${METHODS.join('|')})` });
    const straws = body?.straws_available != null ? Number(body.straws_available) : 0;
    if (!Number.isInteger(straws) || straws < 0) throw new BadRequestException({ code: 'genetics.invalid_straws', title: 'straws_available debe ser un entero ≥ 0' });
    await this.requireRef('animals', body?.donor_dam_id, 'genetics.dam_not_found', 'Donante no encontrada');
    await this.requireRef('animals', body?.sire_id, 'genetics.sire_not_found', 'Toro no encontrado');
    await this.requireRef('semen_batches', body?.semen_batch_id, 'genetics.batch_not_found', 'Partida de semen no encontrada');
    await this.requireRef('storage_tanks', body?.tank_id, 'genetics.tank_not_found', 'Termo no encontrado');
    return this.db.one(
      `INSERT INTO embryos (tenant_id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, straws_available, tank_id, created_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, straws_available, tank_id, created_date`,
      [this.db.tenant, body?.donor_dam_id ?? null, body?.sire_id ?? null, body?.semen_batch_id ?? null, body?.stage ?? null, body?.grade ?? null, body?.production_method ?? null, straws, body?.tank_id ?? null, body?.created_date ?? null, this.db.user],
    );
  }

  async adjustStraws(id: string, delta: number, reason: string) {
    if (!ADJUST_REASONS.includes(reason)) throw new BadRequestException({ code: 'genetics.invalid_reason', title: `reason inválido (${ADJUST_REASONS.join('|')})` });
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException({ code: 'genetics.invalid_delta', title: 'delta debe ser un entero distinto de 0' });
    return this.db.tx(async (q) => this.applyStrawsDelta(q, id, delta));
  }

  /** Aplica el delta al saldo con lock de fila y guard de no-negativo. Reutilizable dentro de una tx. */
  async applyStrawsDelta(q: Q, id: string, delta: number) {
    const t = this.db.tenant;
    const e = await q.one<{ id: string; straws_available: number }>(`SELECT id, straws_available FROM embryos WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, t]);
    if (!e) throw new NotFoundException({ code: 'genetics.embryo_not_found', title: 'Embrión no encontrado' });
    const next = e.straws_available + delta;
    if (next < 0) throw new ForbiddenException({ code: 'genetics.insufficient_embryos', title: `Embriones insuficientes: hay ${e.straws_available}, se intenta retirar ${-delta}.` });
    await q.query(`UPDATE embryos SET straws_available=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return { id, straws_available: next };
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE embryos SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'genetics.embryo_not_found', title: 'Embrión no encontrado' });
    return { id, deleted: true };
  }

  private async requireRef(table: string, id: string | null | undefined, code: string, title: string) {
    if (!id) return;
    const r = await this.db.one<{ id: string }>(`SELECT id FROM ${table} WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!r) throw new NotFoundException({ code, title });
  }
}
