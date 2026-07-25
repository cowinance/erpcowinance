import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvalidStrawTransitionError,
  assertStrawTransition,
  summarizeStraws,
  validateStrawBatch,
  type StrawStatus,
} from '@cowinance/domain';
import { DbService, type Q } from '../../db/db.service';

/**
 * Pajuelas: la unidad física (GT-2).
 *
 * Acá se mudó la REGLA ÚNICA del stock. Antes vivía en `adjustStraws`, que sumaba y restaba un
 * contador; ahora la única mutación posible es una **transición de estado de una unidad**, y el
 * saldo es el resultado de contarlas. Un contador y unas filas serían dos fuentes del mismo número
 * —el bug que ya nos costó caro en presupuestos con LEDGER_COUNTS— así que el contador se fue.
 *
 * `applyStrawsDelta` sigue existiendo con la misma firma porque reproducción y los botones +/− de
 * la web la usan: por dentro ya no toca ningún contador, crea o consume unidades.
 */
@Injectable()
export class StrawsService {
  constructor(private readonly db: DbService) {}

  private dominio<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidStrawTransitionError)
        throw new BadRequestException({ code: 'genetics.invalid_straw', title: e.message });
      throw e;
    }
  }

  /** Origen de una pajuela: exactamente uno de los dos. */
  private origen(owner: { semen_batch_id?: string | null; embryo_id?: string | null }) {
    const semen = owner.semen_batch_id ?? null;
    const embryo = owner.embryo_id ?? null;
    if (!!semen === !!embryo)
      throw new BadRequestException({
        code: 'genetics.invalid_straw_origin',
        title: 'Una pajuela es de una partida de semen o de un embrión, no de las dos ni de ninguna.',
      });
    return { kind: semen ? ('semen' as const) : ('embryo' as const), semen, embryo };
  }

  // ─────────────────────────── Altas y consulta ───────────────────────────

  /**
   * Alta en bloque: «20 pajuelas del toro Sansão». Con `goblet_id` quedan ubicadas de entrada; sin
   * él quedan como «sin ubicar», que es lo honesto cuando la caja llegó y todavía no se cargó en el
   * termo.
   */
  async createBatch(owner: { semen_batch_id?: string | null; embryo_id?: string | null }, body: any) {
    const { kind, semen, embryo } = this.origen(owner);
    const input = this.dominio(() => validateStrawBatch(body));
    await this.requireOwner(kind, (semen ?? embryo)!);
    if (input.goblet_id) await this.requireGoblet(input.goblet_id);

    const filas = await this.db.query<any>(
      `INSERT INTO cryo_straws (tenant_id, kind, semen_batch_id, embryo_id, goblet_id, code, notes, created_by)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8 FROM generate_series(1, $9)
       RETURNING id, code, status, goblet_id`,
      [this.db.tenant, kind, semen, embryo, input.goblet_id, input.code, input.notes, this.db.user, input.quantity],
    );
    return { created: filas.length, straws: filas };
  }

  /** Las pajuelas de una partida o de un embrión, con su ubicación resuelta. */
  async listFor(owner: { semen_batch_id?: string | null; embryo_id?: string | null }) {
    const { semen, embryo } = this.origen(owner);
    return this.db.query<any>(
      `SELECT s.id, s.code, s.status, s.status_reason, s.goblet_id, s.notes,
              s.used_at, s.breeding_event_id,
              g.code AS goblet_code, g.color AS goblet_color,
              c.code AS canister_code, c.color AS canister_color,
              t.code AS tank_code
       FROM cryo_straws s
       LEFT JOIN cryo_goblets g ON g.id = s.goblet_id AND g.deleted_at IS NULL
       LEFT JOIN cryo_canisters c ON c.id = g.canister_id AND c.deleted_at IS NULL
       LEFT JOIN storage_tanks t ON t.id = c.tank_id AND t.deleted_at IS NULL
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
         AND ($2::uuid IS NULL OR s.semen_batch_id = $2::uuid)
         AND ($3::uuid IS NULL OR s.embryo_id = $3::uuid)
       ORDER BY s.status, t.code NULLS LAST, c.code NULLS LAST, g.code NULLS LAST, s.created_at`,
      [this.db.tenant, semen, embryo],
    );
  }

  /** Qué hay dentro de un gobelete: la pregunta que se hace parado frente al termo. */
  async listByGoblet(gobletId: string) {
    return this.db.query<any>(
      `SELECT s.id, s.code, s.status, s.kind,
              b.batch_code, b.sire_name_external, a_tag.value AS sire_tag,
              s.embryo_id, e.stage, e.grade
       FROM cryo_straws s
       LEFT JOIN semen_batches b ON b.id = s.semen_batch_id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = b.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) a_tag ON true
       LEFT JOIN embryos e ON e.id = s.embryo_id AND e.deleted_at IS NULL
       WHERE s.tenant_id = $1 AND s.goblet_id = $2 AND s.deleted_at IS NULL AND s.status = 'stored'
       ORDER BY s.created_at`,
      [this.db.tenant, gobletId],
    );
  }

  /**
   * Saldos por partida, en UNA consulta.
   *
   * Se agrupa acá y no se cuenta por partida desde el listado porque `/genetics/semen` devuelve
   * todas las partidas: un conteo por fila sería un n+1 que crece con el catálogo genético, que es
   * justo lo que más crece.
   */
  async countsByOwner(column: 'semen_batch_id' | 'embryo_id'): Promise<Map<string, ReturnType<typeof summarizeStraws>>> {
    const filas = await this.db.query<{ owner: string; status: StrawStatus; goblet_id: string | null }>(
      `SELECT ${column} AS owner, status, goblet_id
       FROM cryo_straws
       WHERE tenant_id = $1 AND ${column} IS NOT NULL AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const porDueño = new Map<string, { status: StrawStatus; goblet_id: string | null }[]>();
    for (const f of filas) {
      const lista = porDueño.get(f.owner) ?? [];
      lista.push({ status: f.status, goblet_id: f.goblet_id });
      porDueño.set(f.owner, lista);
    }
    return new Map([...porDueño].map(([id, rows]) => [id, summarizeStraws(rows)]));
  }

  // ───────────────────────────── Movimientos ──────────────────────────────

  /**
   * Mover pajuelas a un gobelete (o sacarles la ubicación con `null`). Se mueve un conjunto y no de
   * a una porque así es como se trabaja: se saca un gobelete entero y se reparte.
   */
  async move(ids: string[], gobletId: string | null) {
    if (!Array.isArray(ids) || ids.length === 0)
      throw new BadRequestException({ code: 'genetics.no_straws', title: 'No se indicó ninguna pajuela' });
    if (gobletId) await this.requireGoblet(gobletId);

    // Una pajuela que ya salió del termo no se mueve: no está para mover.
    const movidas = await this.db.query<any>(
      `UPDATE cryo_straws SET goblet_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND status = 'stored'
       RETURNING id`,
      [this.db.tenant, ids, gobletId],
    );
    if (movidas.length !== ids.length)
      throw new ConflictException({
        code: 'genetics.straw_not_movable',
        title: `Se movieron ${movidas.length} de ${ids.length}: el resto ya no está en el termo.`,
      });
    return { moved: movidas.length, goblet_id: gobletId };
  }

  /** Anotar el código impreso, que normalmente se lee recién con la pajuela en la mano. */
  async setCode(id: string, code: unknown) {
    const valor = typeof code === 'string' && code.trim() ? code.trim().slice(0, 64) : null;
    const r = await this.db.query<any>(
      `UPDATE cryo_straws SET code = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id, code`,
      [this.db.tenant, id, valor],
    );
    if (r.length === 0) throw new NotFoundException({ code: 'genetics.straw_not_found', title: 'Pajuela no encontrada' });
    return r[0];
  }

  /** Cambio de estado con la regla del dominio. Es la única salida de stock que no es un servicio. */
  async transition(id: string, to: StrawStatus, reason?: string) {
    return this.db.tx(async (q) => {
      const s = await q.one<{ id: string; status: StrawStatus }>(
        `SELECT id, status FROM cryo_straws WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [id, this.db.tenant],
      );
      if (!s) throw new NotFoundException({ code: 'genetics.straw_not_found', title: 'Pajuela no encontrada' });
      try {
        assertStrawTransition(s.status, to);
      } catch (e) {
        throw new ConflictException({ code: 'genetics.invalid_straw_transition', title: (e as Error).message });
      }
      const r = await q.query<any>(
        // `$3` aparece en la asignación Y en la comparación: sin castear, el motor no deduce un
        // tipo único y falla con «inconsistent types deduced for parameter». Ya nos pasó antes.
        `UPDATE cryo_straws
         SET status=$3::text, status_reason=$4,
             used_at = CASE WHEN $3::text = 'stored' THEN NULL ELSE now() END,
             updated_at=now()
         WHERE id=$1 AND tenant_id=$2
         RETURNING id, status, status_reason`,
        [id, this.db.tenant, to, typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 64) : null],
      );
      return r[0];
    });
  }

  // ──────────────────────────── Reserva (GT-3) ────────────────────────────

  /**
   * Reserva una pajuela para un animal. La unidad sigue en el termo pero deja de estar libre.
   *
   * `FOR UPDATE` no es ceremonia: dos personas planificando la misma campaña a la vez llegarían a
   * la misma pajuela libre, y sin el lock las dos se la llevarían.
   */
  async reserve(q: Q, strawId: string, animalId: string): Promise<void> {
    const s = await q.one<{ id: string; status: StrawStatus; reserved_for_animal_id: string | null }>(
      `SELECT id, status, reserved_for_animal_id FROM cryo_straws
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [strawId, this.db.tenant],
    );
    if (!s) throw new NotFoundException({ code: 'genetics.straw_not_found', title: 'Pajuela no encontrada' });
    // Reservarla otra vez para el MISMO animal es reaplicar el mismo plan: no es un error.
    if (s.status === 'reserved' && s.reserved_for_animal_id === animalId) return;
    try {
      assertStrawTransition(s.status, 'reserved');
    } catch (e) {
      throw new ConflictException({ code: 'genetics.straw_not_available', title: (e as Error).message });
    }
    await q.query(
      `UPDATE cryo_straws SET status='reserved', reserved_for_animal_id=$3, updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [strawId, this.db.tenant, animalId],
    );
  }

  /** Suelta la reserva y devuelve la pajuela al stock libre. Silencioso si ya no estaba reservada. */
  async release(q: Q, strawId: string): Promise<void> {
    await q.query(
      `UPDATE cryo_straws SET status='stored', reserved_for_animal_id=NULL, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND status='reserved' AND deleted_at IS NULL`,
      [strawId, this.db.tenant],
    );
  }

  // ─────────────────────────── Consumo (repro) ────────────────────────────

  /**
   * Consume `n` pajuelas disponibles del origen indicado y devuelve sus ids.
   *
   * Cuál se toma NO es arbitrario: se prefiere la **ubicada más antigua**. Lo más antiguo primero
   * porque el nitrógeno no conserva para siempre y lo viejo es lo que conviene gastar; y ubicada
   * antes que sin ubicar porque una pajuela sin ubicar no se puede ir a buscar — descontarla dejaría
   * el saldo bien y al operario sin nada que sacar del termo.
   *
   * Con `strawId` se consume UNA en concreto: es el caso del plan de servicio de GT-3 y el del
   * desvío en el corral, cuando el técnico usa otra distinta de la planificada.
   */
  async consume(
    q: Q,
    owner: { semen_batch_id?: string | null; embryo_id?: string | null },
    n: number,
    reason: string,
    strawId?: string | null,
  ): Promise<string[]> {
    const { semen, embryo } = this.origen(owner);
    const t = this.db.tenant;

    if (strawId) {
      const s = await q.one<{ id: string; status: StrawStatus }>(
        `SELECT id, status FROM cryo_straws
         WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL
           AND ($3::uuid IS NULL OR semen_batch_id=$3::uuid) AND ($4::uuid IS NULL OR embryo_id=$4::uuid)
         FOR UPDATE`,
        [strawId, t, semen, embryo],
      );
      if (!s) throw new NotFoundException({ code: 'genetics.straw_not_found', title: 'Pajuela no encontrada en ese origen' });
      // Reservada TAMBIÉN se puede consumir: es el caso normal del plan, donde la pajuela se apartó
      // justamente para este servicio. Lo que no se puede es usar una que ya salió del termo.
      if (s.status !== 'stored' && s.status !== 'reserved')
        throw new ConflictException({ code: 'genetics.straw_not_available', title: `La pajuela ya no está disponible (${s.status}).` });
      await this.marcarUsadas(q, [s.id], reason);
      return [s.id];
    }

    const elegidas = await q.query<{ id: string }>(
      `SELECT id FROM cryo_straws
       WHERE tenant_id=$1 AND deleted_at IS NULL AND status='stored'
         AND ($2::uuid IS NULL OR semen_batch_id=$2::uuid) AND ($3::uuid IS NULL OR embryo_id=$3::uuid)
       ORDER BY (goblet_id IS NULL), created_at
       LIMIT $4
       FOR UPDATE`,
      [t, semen, embryo, n],
    );
    if (elegidas.length < n) {
      const falta = semen ? 'Pajuelas' : 'Embriones';
      throw new ForbiddenException({
        code: semen ? 'genetics.insufficient_straws' : 'genetics.insufficient_embryos',
        title: `${falta} insuficientes: hay ${elegidas.length}, se intenta retirar ${n}.`,
      });
    }
    const ids = elegidas.map((e) => e.id);
    await this.marcarUsadas(q, ids, reason);
    return ids;
  }

  /** Devuelve al stock las pajuelas de un servicio que se deshizo. */
  async releaseByEvent(q: Q, breedingEventId: string): Promise<number> {
    const r = await q.query<{ id: string }>(
      `UPDATE cryo_straws
       SET status='stored', status_reason=NULL, reserved_for_animal_id=NULL, used_at=NULL, breeding_event_id=NULL, updated_at=now()
       WHERE tenant_id=$1 AND breeding_event_id=$2 AND status='used' AND deleted_at IS NULL
       RETURNING id`,
      [this.db.tenant, breedingEventId],
    );
    return r.length;
  }

  /** Ata las pajuelas consumidas al servicio que las usó: es lo que responde «¿qué le pusimos?». */
  async linkToEvent(q: Q, ids: string[], breedingEventId: string) {
    if (ids.length === 0) return;
    await q.query(
      `UPDATE cryo_straws SET breeding_event_id=$3, updated_at=now()
       WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [this.db.tenant, ids, breedingEventId],
    );
  }

  private async marcarUsadas(q: Q, ids: string[], reason: string) {
    await q.query(
      `UPDATE cryo_straws SET status='used', status_reason=$3, reserved_for_animal_id=NULL, used_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [this.db.tenant, ids, reason.slice(0, 64)],
    );
  }

  // ───────────────────────────────── Apoyo ────────────────────────────────

  private async requireOwner(kind: 'semen' | 'embryo', id: string) {
    const tabla = kind === 'semen' ? 'semen_batches' : 'embryos';
    const r = await this.db.one<{ id: string }>(
      `SELECT id FROM ${tabla} WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!r)
      throw new NotFoundException({
        code: kind === 'semen' ? 'genetics.batch_not_found' : 'genetics.embryo_not_found',
        title: kind === 'semen' ? 'Partida de semen no encontrada' : 'Embrión no encontrado',
      });
  }

  private async requireGoblet(id: string) {
    const r = await this.db.one<{ id: string }>(
      `SELECT id FROM cryo_goblets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!r) throw new NotFoundException({ code: 'genetics.goblet_not_found', title: 'Gobelete no encontrado' });
  }
}
