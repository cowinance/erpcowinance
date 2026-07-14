import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

const ADJUST_REASONS = ['acquisition', 'insemination', 'adjustment', 'loss'];

/**
 * Genética — partidas de semen (G-1): `semen_batches` (pajuelas por toro/lote). El saldo de pajuelas
 * (`straws_available`) es materializado y su ÚNICA mutación pasa por `adjustStraws` (sin negativo);
 * en G-2 la inseminación lo consumirá. Todo por tenant; baja lógica por `deleted_at`.
 */
@Injectable()
export class SemenService {
  constructor(private readonly db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT sb.id, sb.batch_code, sb.sire_id, a_tag.value AS sire_tag, sb.sire_name_external, sb.breed_id,
              sb.supplier_id, sb.straws_available, sb.tank_id, sb.canister, sb.acquired_date, sb.unit_cost::float AS unit_cost
       FROM semen_batches sb
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = sb.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) a_tag ON true
       WHERE sb.tenant_id=$1 AND sb.deleted_at IS NULL ORDER BY sb.straws_available DESC, sb.batch_code`,
      [this.db.tenant],
    );
  }

  async get(id: string) {
    const b = await this.db.one(
      `SELECT id, batch_code, sire_id, sire_name_external, breed_id, supplier_id, straws_available, tank_id, canister, acquired_date, unit_cost::float AS unit_cost
       FROM semen_batches WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!b) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    return b;
  }

  async create(body: any) {
    const code = String(body?.batch_code ?? '').trim();
    if (!code) throw new BadRequestException({ code: 'genetics.missing_batch_code', title: 'batch_code es obligatorio' });
    const straws = body?.straws_available != null ? Number(body.straws_available) : 0;
    if (!Number.isInteger(straws) || straws < 0) throw new BadRequestException({ code: 'genetics.invalid_straws', title: 'straws_available debe ser un entero ≥ 0' });
    await this.requireRef('animals', body?.sire_id, 'genetics.sire_not_found', 'Toro no encontrado');
    await this.requireRef('breeds', body?.breed_id, 'genetics.breed_not_found', 'Raza no encontrada');
    await this.requireRef('suppliers', body?.supplier_id, 'genetics.supplier_not_found', 'Proveedor no encontrado');
    await this.requireRef('storage_tanks', body?.tank_id, 'genetics.tank_not_found', 'Termo no encontrado');
    return this.db.one(
      `INSERT INTO semen_batches (tenant_id, sire_id, sire_name_external, breed_id, supplier_id, batch_code, straws_available, tank_id, canister, acquired_date, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, batch_code, sire_id, sire_name_external, breed_id, supplier_id, straws_available, tank_id, canister, acquired_date, unit_cost::float AS unit_cost`,
      [this.db.tenant, body?.sire_id ?? null, body?.sire_name_external ?? null, body?.breed_id ?? null, body?.supplier_id ?? null, code, straws, body?.tank_id ?? null, body?.canister ?? null, body?.acquired_date ?? null, body?.unit_cost ?? null, this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.batch_code === 'string') {
      const c = body.batch_code.trim();
      if (!c) throw new BadRequestException({ code: 'genetics.missing_batch_code', title: 'batch_code no puede ser vacío' });
      set('batch_code', c);
    }
    if (body?.sire_id !== undefined) {
      await this.requireRef('animals', body.sire_id, 'genetics.sire_not_found', 'Toro no encontrado');
      set('sire_id', body.sire_id ?? null);
    }
    if (body?.tank_id !== undefined) {
      await this.requireRef('storage_tanks', body.tank_id, 'genetics.tank_not_found', 'Termo no encontrado');
      set('tank_id', body.tank_id ?? null);
    }
    for (const f of ['sire_name_external', 'canister', 'acquired_date', 'unit_cost'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'genetics.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE semen_batches SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, batch_code, sire_id, sire_name_external, straws_available, canister, unit_cost::float AS unit_cost`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    return row;
  }

  /**
   * ÚNICO punto de mutación del saldo de pajuelas: suma (alta/compra) o resta (consumo). Nunca deja el
   * saldo negativo (403). En G-2 la inseminación reusa este método con reason='insemination'.
   */
  async adjustStraws(id: string, delta: number, reason: string) {
    if (!ADJUST_REASONS.includes(reason)) throw new BadRequestException({ code: 'genetics.invalid_reason', title: `reason inválido (${ADJUST_REASONS.join('|')})` });
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException({ code: 'genetics.invalid_delta', title: 'delta debe ser un entero distinto de 0' });
    return this.db.tx(async (q) => this.applyStrawsDelta(q, id, delta));
  }

  /** Aplica el delta al saldo con lock de fila y guard de no-negativo. Reutilizable dentro de una tx. */
  async applyStrawsDelta(q: Q, id: string, delta: number) {
    const t = this.db.tenant;
    const b = await q.one<{ id: string; straws_available: number }>(`SELECT id, straws_available FROM semen_batches WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, t]);
    if (!b) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    const next = b.straws_available + delta;
    if (next < 0) throw new ForbiddenException({ code: 'genetics.insufficient_straws', title: `Pajuelas insuficientes: hay ${b.straws_available}, se intenta retirar ${-delta}.` });
    await q.query(`UPDATE semen_batches SET straws_available=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return { id, straws_available: next };
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE semen_batches SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    return { id, deleted: true };
  }

  /** Valida que una referencia opcional exista y sea del tenant. */
  private async requireRef(table: string, id: string | null | undefined, code: string, title: string) {
    if (!id) return;
    const r = await this.db.one<{ id: string }>(`SELECT id FROM ${table} WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!r) throw new NotFoundException({ code, title });
  }
}
