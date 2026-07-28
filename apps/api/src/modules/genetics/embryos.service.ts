import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { StrawsService } from './straws.service';

const ADJUST_REASONS = ['acquisition', 'transfer', 'adjustment', 'loss'];
const METHODS = ['in_vivo', 'ivf'];

/**
 * Genética — embriones (G-2b): `embryos` es ahora la COLECTA (donante, toro, estadio, grado) y cada
 * embrión físico es una fila de `cryo_straws`.
 *
 * El contador `straws_available` no solo era una segunda fuente del stock: acá además PERDÍA
 * información. Una fila decía «4 embriones de esta donante con este toro», pero esos 4 no son
 * intercambiables. Al transferir se restaba 1 de 4 y desaparecía para siempre cuál entró en esa
 * receptora — que es exactamente lo que hay que poder responder.
 */
@Injectable()
export class EmbryosService {
  constructor(
    private readonly db: DbService,
    private readonly straws: StrawsService,
  ) {}

  async list() {
    const [filas, saldos] = await Promise.all([
      this.db.query<any>(
        // Con las caravanas de donante y toro: en el corral, elegir un embrión por su UUID no es
        // elegir. Lo que identifica a un embrión para quien lo va a transferir es de qué vaca y de
        // qué toro salió.
        `SELECT e.id, e.donor_dam_id, e.sire_id, e.semen_batch_id, e.stage, e.grade, e.production_method,
                e.tank_id, e.created_date,
                COALESCE(d.name, dtag.value) AS donor_name,
                COALESCE(sa.name, stag.value) AS sire_name
           FROM embryos e
           LEFT JOIN animals d  ON d.id  = e.donor_dam_id AND d.deleted_at IS NULL
           LEFT JOIN animals sa ON sa.id = e.sire_id      AND sa.deleted_at IS NULL
           LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = e.donor_dam_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) dtag ON true
           LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = e.sire_id      AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) stag ON true
          WHERE e.tenant_id=$1 AND e.deleted_at IS NULL ORDER BY e.created_date DESC NULLS LAST`,
        [this.db.tenant],
      ),
      this.straws.countsByOwner('embryo_id'),
    ]);
    return filas.map((f) => ({ ...f, ...this.saldo(saldos.get(f.id)) }));
  }

  async get(id: string) {
    const e = await this.db.one<any>(
      `SELECT id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, tank_id, created_date
       FROM embryos WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!e) throw new NotFoundException({ code: 'genetics.embryo_not_found', title: 'Embrión no encontrado' });
    const saldos = await this.straws.countsByOwner('embryo_id');
    return { ...e, ...this.saldo(saldos.get(id)) };
  }

  /** Mismo nombre de siempre para no romper a quien lo consume; ahora es un conteo con desglose. */
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
    if (body?.production_method != null && !METHODS.includes(body.production_method)) throw new BadRequestException({ code: 'genetics.invalid_method', title: `production_method inválido (${METHODS.join('|')})` });
    const straws = body?.straws_available != null ? Number(body.straws_available) : 0;
    if (!Number.isInteger(straws) || straws < 0) throw new BadRequestException({ code: 'genetics.invalid_straws', title: 'straws_available debe ser un entero ≥ 0' });
    await this.requireRef('animals', body?.donor_dam_id, 'genetics.dam_not_found', 'Donante no encontrada');
    await this.requireRef('animals', body?.sire_id, 'genetics.sire_not_found', 'Toro no encontrado');
    await this.requireRef('semen_batches', body?.semen_batch_id, 'genetics.batch_not_found', 'Partida de semen no encontrada');
    await this.requireRef('storage_tanks', body?.tank_id, 'genetics.tank_not_found', 'Termo no encontrado');
    const row = await this.db.one<any>(
      `INSERT INTO embryos (tenant_id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, tank_id, created_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, donor_dam_id, sire_id, semen_batch_id, stage, grade, production_method, tank_id, created_date`,
      [this.db.tenant, body?.donor_dam_id ?? null, body?.sire_id ?? null, body?.semen_batch_id ?? null, body?.stage ?? null, body?.grade ?? null, body?.production_method ?? null, body?.tank_id ?? null, body?.created_date ?? null, this.db.user],
    );
    // Una colecta de 4 embriones son 4 unidades físicas, cada una con su identidad.
    if (straws > 0) await this.straws.createBatch({ embryo_id: row!.id }, { quantity: straws });
    return { ...row, ...this.saldo({ available: straws, located: 0, unlocated: straws, reserved: 0, used: 0 }) };
  }

  async adjustStraws(id: string, delta: number, reason: string) {
    if (!ADJUST_REASONS.includes(reason)) throw new BadRequestException({ code: 'genetics.invalid_reason', title: `reason inválido (${ADJUST_REASONS.join('|')})` });
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException({ code: 'genetics.invalid_delta', title: 'delta debe ser un entero distinto de 0' });
    return this.db.tx(async (q) => this.applyStrawsDelta(q, id, delta, reason));
  }

  /** Reutilizable dentro de una tx. Ya no mueve un contador: crea o consume unidades. */
  async applyStrawsDelta(q: Q, id: string, delta: number, reason = 'adjustment') {
    const e = await q.one<{ id: string }>(`SELECT id FROM embryos WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!e) throw new NotFoundException({ code: 'genetics.embryo_not_found', title: 'Embrión no encontrado' });

    let consumed: string[] = [];
    if (delta > 0)
      await q.query(
        `INSERT INTO cryo_straws (tenant_id, kind, embryo_id, created_by)
         SELECT $1, 'embryo', $2, $3 FROM generate_series(1, $4)`,
        [this.db.tenant, id, this.db.user, delta],
      );
    else consumed = await this.straws.consume(q, { embryo_id: id }, -delta, reason);

    const n = await q.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_straws WHERE tenant_id=$1 AND embryo_id=$2 AND status='stored' AND deleted_at IS NULL`,
      [this.db.tenant, id],
    );
    return { id, straws_available: n?.n ?? 0, consumed_straw_ids: consumed };
  }

  /** Transferencia embrionaria: consume el embrión concreto si se indicó, o el más antiguo ubicado. */
  async consumeStraw(embryoId: string, reason: string, strawId?: string | null): Promise<string[]> {
    return this.straws.consume(this.db, { embryo_id: embryoId }, 1, reason, strawId ?? null);
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
