import { BadRequestException, Injectable } from '@nestjs/common';
import { HlcClock } from '@cowinance/sync-core';
import type { PutOp } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

/**
 * Núcleo NEUTRAL de movimientos de hacienda (P3 M-1.a). Regla y escritura ÚNICAS
 * del movimiento entre lotes/potreros, reutilizadas por todos los canales (web
 * individual/grupal, mapa de lote completo, sync entrante y futuras integraciones).
 * Cada canal aporta CONTEXTO explícito (`origin`, `hlc`, `emitServerOrigin`); el
 * cuerpo no ramifica por canal ni reimplementa el trío campo+hecho+timeline.
 *
 * Un movimiento produce, por animal que cambia: (1) `current_lot_id`/
 * `current_paddock_id` vía LWW en `sync_row_state`, (2) UNA fila `animal_movements`,
 * (3) UN evento `movement` de timeline; y, para orígenes server-authored, UN
 * changeset server-origin con los `put` de campo. El hecho lo crea SOLO esta
 * operación (nunca un `put` de campo suelto), garantizando exactamente un hecho.
 *
 * INVARIANTE lote–potrero (duro, no warning): en todo estado final, si el animal
 * tiene lote, su potrero es el del lote (`P(lote)`). Las intenciones incoherentes
 * se RECHAZAN con `movement.lot_paddock_mismatch` (sin persistencia parcial).
 *
 * Matriz de transiciones — `to.lot`/`to.paddock` ∈ {ausente(undefined), UUID, null};
 * `L0`/`K0` = lote/potrero actual; `P(x)` = potrero actual del lote x:
 *
 *   lot        paddock   → estado final                              | error
 *   ─────────────────────────────────────────────────────────────────────────────
 *   ausente    ausente   → —                                         | movement.noop
 *   Y          ausente   → (Y, P(Y))                                 | —
 *   Y          B         → (Y, B)  si B=P(Y)                         | mismatch si B≠P(Y)
 *   Y          null      → (Y, null) si P(Y)=null                    | mismatch si P(Y)≠null
 *   null       ausente   → (null, K0)  [queda sin lote, coherente]   | —
 *   null       B         → (null, B)                                 | —
 *   null       null      → (null, null)                              | —
 *   ausente    B         → (L0, B) si L0=null ó B=P(L0)              | mismatch si L0≠null y B≠P(L0)
 *   ausente    null      → (L0, null) si L0=null ó P(L0)=null        | mismatch si L0≠null y P(L0)≠null
 */

/**
 * De qué superficie salió el movimiento. `import` se sumó cuando el ALTA de un animal pasó a
 * registrarse como un movimiento de ingreso: una carga masiva de planilla no es lo mismo que alguien
 * moviendo un lote desde el mapa, y el historial del lote lo muestra.
 */
export type MovementOrigin = 'web' | 'map' | 'sync' | 'import';

/** Intención de destino: clave ausente(undefined)=sin cambio; null=limpiar; string=asignar. */
export interface MovementIntent {
  lot?: string | null;
  paddock?: string | null;
}

export interface AnimalLocation {
  lot: string | null;
  paddock: string | null;
}

export type ResolveResult =
  | { ok: true; lot: string | null; paddock: string | null }
  | { ok: false; code: 'movement.lot_paddock_mismatch' | 'movement.noop'; detail: string };

/**
 * Regla PURA de resolución del destino de UN animal (sin DB), fuente única del
 * invariante lote–potrero. `paddockOfLot(id)` devuelve `P(id)` (o null).
 */
export function resolveDestination(
  current: AnimalLocation,
  intent: MovementIntent,
  paddockOfLot: (lotId: string) => string | null,
): ResolveResult {
  const lotIntent = intent.lot; // undefined | null | string
  const padIntent = intent.paddock;
  if (lotIntent === undefined && padIntent === undefined) {
    return { ok: false, code: 'movement.noop', detail: 'Sin lote ni potrero de destino' };
  }

  const lot = lotIntent === undefined ? current.lot : lotIntent; // conservar | asignar | limpiar
  let paddock: string | null;

  if (lot !== null) {
    const pOfLot = paddockOfLot(lot);
    if (padIntent === undefined) {
      paddock = pOfLot; // derivado del lote (invariante por construcción)
    } else if (padIntent === pOfLot) {
      paddock = padIntent; // explícito coherente con el lote
    } else {
      return { ok: false, code: 'movement.lot_paddock_mismatch', detail: 'El lote no pertenece al potrero indicado' };
    }
  } else {
    paddock = padIntent === undefined ? current.paddock : padIntent; // sin lote → potrero libre
  }

  return { ok: true, lot, paddock };
}

export interface RecordMovementInput {
  animalIds: string[];
  to: MovementIntent;
  reason: string;
  movedAt?: string;
  actorUserId: string;
  origin: MovementOrigin;
  /** Clave de idempotencia por operación (op id en sync, uuid/Idempotency-Key en REST). */
  movementId: string;
  /** Reloj del movimiento; server tick por defecto (para web/map). En sync = HLC del op. */
  hlc?: string;
  /** true para orígenes server-authored (web/map) → emite changeset; false en sync entrante. */
  emitServerOrigin: boolean;
}

@Injectable()
export class MovementService {
  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly serverOrigin: ServerOriginChangesetWriter,
  ) {}

  /**
   * Registra un movimiento para 1..N animales (individual o grupal), atómico:
   * cualquier incoherencia lote–potrero aborta la operación completa. Idempotente
   * por `movementId` (los animales ya procesados por esa operación se omiten).
   * Diff-aware: un animal cuyo destino resuelto == estado actual no genera hecho.
   */
  async recordMovement(q: Q, input: RecordMovementInput): Promise<{ moved: number; skipped: number; syncOps: PutOp[] }> {
    const t = this.db.tenant;
    const { to } = input;
    if (to.lot === undefined && to.paddock === undefined) {
      throw new BadRequestException({ code: 'movement.noop', title: 'Se requiere lote o potrero de destino' });
    }

    // Existencia del destino explícito (antes de tocar nada).
    if (typeof to.lot === 'string') {
      const lot = await q.one<{ id: string }>(`SELECT id FROM lots WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [to.lot, t]);
      if (!lot) throw new BadRequestException({ code: 'lot.not_found', title: 'Lote de destino no encontrado' });
    }
    if (typeof to.paddock === 'string') {
      const pad = await q.one<{ id: string }>(`SELECT id FROM paddocks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [to.paddock, t]);
      if (!pad) throw new BadRequestException({ code: 'paddock.not_found', title: 'Potrero de destino no encontrado' });
    }

    const animals = await q.query<{ id: string; current_lot_id: string | null; current_paddock_id: string | null }>(
      `SELECT id, current_lot_id, current_paddock_id FROM animals
       WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
      [input.animalIds, t],
    );
    if (!animals.length) return { moved: 0, skipped: 0, syncOps: [] };

    // Idempotencia: animales ya procesados por esta misma operación → se omiten enteros.
    const alreadyDone = new Set(
      (
        await q.query<{ animal_id: string }>(
          `SELECT animal_id FROM animal_movements WHERE tenant_id = $1 AND movement_id = $2 AND animal_id = ANY($3)`,
          [t, input.movementId, animals.map((a) => a.id)],
        )
      ).map((r) => r.animal_id),
    );

    // Potrero de cada lote implicado (destino Y + lote actual de cada animal), en UNA query.
    const lotIds = [
      ...(typeof to.lot === 'string' ? [to.lot] : []),
      ...animals.map((a) => a.current_lot_id).filter((x): x is string => !!x),
    ];
    const paddockOfLot = new Map<string, string | null>();
    if (lotIds.length) {
      const rows = await q.query<{ id: string; current_paddock_id: string | null }>(
        `SELECT id, current_paddock_id FROM lots WHERE id = ANY($1) AND tenant_id = $2`,
        [[...new Set(lotIds)], t],
      );
      for (const r of rows) paddockOfLot.set(r.id, r.current_paddock_id);
    }
    const pOf = (lotId: string): string | null => paddockOfLot.get(lotId) ?? null;

    const movedAt = input.movedAt ?? new Date().toISOString();
    const hlc = input.hlc ?? this.serverClock.tick();
    const syncOps: PutOp[] = [];
    let skipped = 0;

    for (const a of animals) {
      if (alreadyDone.has(a.id)) {
        skipped++;
        continue;
      }
      const res = resolveDestination({ lot: a.current_lot_id, paddock: a.current_paddock_id }, to, pOf);
      if (!res.ok) {
        // Incoherencia lote–potrero → rechazo de dominio; aborta el grupo (sin persistencia parcial).
        throw new BadRequestException({
          code: res.code,
          title: res.code === 'movement.lot_paddock_mismatch' ? 'El lote no pertenece al potrero indicado' : 'Sin lote ni potrero de destino',
        });
      }

      // Diff-aware: solo lo que realmente cambia.
      const fields: Record<string, unknown> = {};
      if (res.lot !== a.current_lot_id) fields.current_lot_id = res.lot;
      if (res.paddock !== a.current_paddock_id) fields.current_paddock_id = res.paddock;
      const cols = Object.keys(fields);
      if (!cols.length) {
        skipped++;
        continue;
      }

      const sets = cols.map((c, i) => `"${c}" = $${i + 3}`).join(', ');
      await q.query(`UPDATE animals SET ${sets}, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [a.id, t, ...cols.map((c) => fields[c])]);

      const existing = (await this.versions.read(q, 'animals', a.id)) ?? {};
      await this.versions.write(q, 'animals', a.id, { ...existing, ...Object.fromEntries(cols.map((c) => [c, hlc])) });

      await q.query(
        `INSERT INTO animal_movements
           (tenant_id, animal_id, moved_at, from_paddock_id, to_paddock_id, from_lot_id, to_lot_id, reason, created_by, origin, movement_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, movement_id, animal_id) WHERE movement_id IS NOT NULL DO NOTHING`,
        [t, a.id, movedAt, a.current_paddock_id, res.paddock, a.current_lot_id, res.lot, input.reason, input.actorUserId, input.origin, input.movementId],
      );

      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'movement',$3,$4,now(),'manual')`,
        [
          t,
          a.id,
          JSON.stringify({
            from_lot: a.current_lot_id,
            to_lot: res.lot,
            from_paddock: a.current_paddock_id,
            to_paddock: res.paddock,
            reason: input.reason,
            origin: input.origin,
          }),
          movedAt,
        ],
      );

      syncOps.push({ kind: 'put', table: 'animals', rowId: a.id, fields, hlc });
    }

    if (input.emitServerOrigin && syncOps.length) {
      await this.serverOrigin.emit(q, syncOps, `movement:${input.movementId}`);
    }
    return { moved: syncOps.length, skipped, syncOps };
  }
}
