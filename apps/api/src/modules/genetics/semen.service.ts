import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { StrawsService } from './straws.service';

const ADJUST_REASONS = ['acquisition', 'insemination', 'adjustment', 'loss'];

/**
 * Genética — partidas de semen (G-1): `semen_batches` (pajuelas por toro/lote).
 *
 * Desde GT-2 el saldo YA NO se guarda: `straws_available` era una columna materializada y ahora es
 * el resultado de contar las pajuelas de `cryo_straws` que siguen disponibles. Un contador y unas
 * filas serían dos fuentes del mismo número, y un día no coinciden. La partida quedó como lo que
 * siempre fue —el origen genético y comercial: qué toro, qué colecta, a quién se le compró— y el
 * stock vive en las unidades.
 */
@Injectable()
export class SemenService {
  constructor(
    private readonly db: DbService,
    private readonly straws: StrawsService,
  ) {}

  async list() {
    const [filas, saldos] = await Promise.all([
      this.db.query<any>(
        `SELECT sb.id, sb.batch_code, sb.sire_id, a_tag.value AS sire_tag, sb.sire_name_external, sb.breed_id,
                sb.supplier_id, sb.tank_id, sb.canister AS legacy_location, sb.acquired_date, sb.unit_cost::float AS unit_cost
         FROM semen_batches sb
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = sb.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) a_tag ON true
         WHERE sb.tenant_id=$1 AND sb.deleted_at IS NULL ORDER BY sb.batch_code`,
        [this.db.tenant],
      ),
      this.straws.countsByOwner('semen_batch_id'),
    ]);
    return filas.map((f) => ({ ...f, ...this.saldo(saldos.get(f.id)) }));
  }

  async get(id: string) {
    const b = await this.db.one<any>(
      `SELECT id, batch_code, sire_id, sire_name_external, breed_id, supplier_id, tank_id,
              canister AS legacy_location, acquired_date, unit_cost::float AS unit_cost
       FROM semen_batches WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!b) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    const saldos = await this.straws.countsByOwner('semen_batch_id');
    return { ...b, ...this.saldo(saldos.get(id)) };
  }

  /**
   * `straws_available` se sigue devolviendo con el mismo nombre —lo consumen la web, el móvil y
   * reproducción— pero ahora es un conteo. Al lado viaja el desglose, que es lo que el contador
   * nunca pudo decir: cuántas de esas están realmente ubicadas dentro de un termo.
   */
  private saldo(c: { available: number; located: number; unlocated: number; reserved: number; used: number } | undefined) {
    return {
      straws_available: c?.available ?? 0,
      straws_located: c?.located ?? 0,
      straws_unlocated: c?.unlocated ?? 0,
      // Reservadas van aparte de las libres (GT-3): están en el termo pero ya tienen dueña. Sumarlas
      // al disponible haría planificar sobre pajuelas que ya están comprometidas.
      straws_reserved: c?.reserved ?? 0,
      straws_used: c?.used ?? 0,
    };
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
    const row = await this.db.one<any>(
      `INSERT INTO semen_batches (tenant_id, sire_id, sire_name_external, breed_id, supplier_id, batch_code, tank_id, canister, acquired_date, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, batch_code, sire_id, sire_name_external, breed_id, supplier_id, tank_id, canister AS legacy_location, acquired_date, unit_cost::float AS unit_cost`,
      [this.db.tenant, body?.sire_id ?? null, body?.sire_name_external ?? null, body?.breed_id ?? null, body?.supplier_id ?? null, code, body?.tank_id ?? null, body?.canister ?? null, body?.acquired_date ?? null, body?.unit_cost ?? null, this.db.user],
    );
    // Comprar una partida es comprar pajuelas: se dan de alta como unidades sin ubicar, porque la
    // caja llegó y todavía nadie abrió el termo para cargarlas.
    if (straws > 0) await this.straws.createBatch({ semen_batch_id: row!.id }, { quantity: straws });
    return { ...row, ...this.saldo({ available: straws, located: 0, unlocated: straws, reserved: 0, used: 0 }) };
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
       RETURNING id, batch_code, sire_id, sire_name_external, canister AS legacy_location, unit_cost::float AS unit_cost`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });
    return row;
  }

  /**
   * Ajuste por cantidad. Mantiene la firma de siempre —la usan reproducción y los botones +/− de la
   * web— pero por dentro ya no hay ningún contador que mover: sumar crea unidades sin ubicar y
   * restar consume las disponibles más antiguas. La regla única del stock se mudó a `StrawsService`.
   */
  async adjustStraws(id: string, delta: number, reason: string) {
    if (!ADJUST_REASONS.includes(reason)) throw new BadRequestException({ code: 'genetics.invalid_reason', title: `reason inválido (${ADJUST_REASONS.join('|')})` });
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException({ code: 'genetics.invalid_delta', title: 'delta debe ser un entero distinto de 0' });
    return this.db.tx(async (q) => this.applyStrawsDelta(q, id, delta, reason));
  }

  /** Reutilizable dentro de una tx. Devuelve el saldo ya recontado, no un número acumulado. */
  async applyStrawsDelta(q: Q, id: string, delta: number, reason = 'adjustment') {
    const b = await q.one<{ id: string }>(`SELECT id FROM semen_batches WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!b) throw new NotFoundException({ code: 'genetics.batch_not_found', title: 'Partida de semen no encontrada' });

    let consumed: string[] = [];
    if (delta > 0) await this.createUnitsInTx(q, id, delta);
    else consumed = await this.straws.consume(q, { semen_batch_id: id }, -delta, reason);

    const n = await q.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_straws WHERE tenant_id=$1 AND semen_batch_id=$2 AND status='stored' AND deleted_at IS NULL`,
      [this.db.tenant, id],
    );
    return { id, straws_available: n?.n ?? 0, consumed_straw_ids: consumed };
  }

  /**
   * Consume UNA pajuela para un servicio. Con `strawId` se consume ésa en concreto; sin él, la
   * disponible más antigua y ya ubicada. Devuelve los ids para poder atarlos al evento después.
   *
   * No abre transacción propia: toda la request comparte una, así que si el servicio falla más
   * adelante el consumo se deshace con él.
   */
  async consumeStraw(batchId: string, reason: string, strawId?: string | null): Promise<string[]> {
    return this.straws.consume(this.db, { semen_batch_id: batchId }, 1, reason, strawId ?? null);
  }

  private async createUnitsInTx(q: Q, batchId: string, n: number) {
    await q.query(
      `INSERT INTO cryo_straws (tenant_id, kind, semen_batch_id, created_by)
       SELECT $1, 'semen', $2, $3 FROM generate_series(1, $4)`,
      [this.db.tenant, batchId, this.db.user, n],
    );
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
