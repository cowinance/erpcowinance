import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HlcClock } from '@cowinance/sync-core';
import type { PutOp } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

export interface AnimalTransitionInput {
  animalId: string;
  /** Estado destino (p.ej. 'sold'). El animal debe estar 'active'. */
  toStatus: string;
  /** Tipo de evento de timeline que acompaña el cambio (p.ej. 'sale'). */
  timelineEventType: string;
  /** Payload del evento de timeline (contexto del cambio). */
  payload?: Record<string, unknown>;
  /** Referencia de origen para el changeset server-origin (p.ej. `sale:<id>`). Idempotencia del emit. */
  originRef: string;
  /** true para orígenes server-authored (REST/web) → emite changeset que converge en devices. */
  emitServerOrigin: boolean;
  hlc?: string;
  occurredAt?: string;
}

export interface AnimalTransitionResult {
  changed: boolean;
  previousStatus: string;
  tag: string | null;
}

/**
 * Regla ÚNICA de una transición de estado de animal que debe CONVERGER en los dispositivos offline
 * (D1 de C-3). Mismo mecanismo de 5 pasos que la mortalidad: (1) `status`+`status_changed_at`,
 * (2) versión LWW del campo autoritativo `status`, (3) evento de timeline, (4) changeset server-origin.
 * No incluye la "fila de hecho": esa la aporta el llamador (p.ej. la venta ES el hecho).
 *
 * Nunca hacer un `UPDATE animals SET status=...` suelto por fuera de este servicio: sin la versión y
 * el server-origin, un device seguiría mostrando el animal como activo.
 *
 * NOTA: `MortalityService` mantiene su propio path (acoplado a su tabla de hecho + UNIQUE); converger
 * mortalidad sobre este servicio queda diferido.
 */
@Injectable()
export class AnimalStatusService {
  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly serverOrigin: ServerOriginChangesetWriter,
  ) {}

  /** Aplica la transición sobre la tx `q` recibida (atómica con el hecho del llamador). */
  async transition(q: Q, input: AnimalTransitionInput): Promise<AnimalTransitionResult> {
    const t = this.db.tenant;
    const animal = await q.one<{ id: string; status: string; tag: string | null }>(
      `SELECT a.id, a.status, ai.value AS tag
       FROM animals a
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x
         WHERE x.animal_id = a.id AND x.type = 'visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [input.animalId, t],
    );
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (animal.status !== 'active') {
      throw new ConflictException({ code: 'animal.not_active', title: `El animal ${animal.tag ?? ''} no está activo (estado: ${animal.status})` });
    }

    const hlc = input.hlc ?? this.serverClock.tick();
    const occurredAt = input.occurredAt ?? new Date().toISOString();

    // (1) estado + status_changed_at.
    await q.query(`UPDATE animals SET status = $3, status_changed_at = $4, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [input.animalId, t, input.toStatus, occurredAt]);
    // (2) versión LWW del campo autoritativo `status`.
    const existing = (await this.versions.read(q, 'animals', input.animalId)) ?? {};
    await this.versions.write(q, 'animals', input.animalId, { ...existing, status: hlc });
    // (3) timeline.
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,now(),'manual')`,
      [t, input.animalId, input.timelineEventType, JSON.stringify(input.payload ?? {}), occurredAt],
    );
    // (4) server-origin: converge status en todos los dispositivos (incl. emisor).
    const ops: PutOp[] = [{ kind: 'put', table: 'animals', rowId: input.animalId, fields: { status: input.toStatus }, hlc }];
    if (input.emitServerOrigin) await this.serverOrigin.emit(q, ops, input.originRef);

    return { changed: true, previousStatus: animal.status, tag: animal.tag };
  }

  /**
   * Estados de ciclo de vida cuyo cambio no tiene un flujo/tabla-de-hecho dedicado y por eso
   * se manejan por acá: descarte, pérdida y transferencia de salida. `sold`→Ventas, `dead`→Mortalidad
   * (cada uno con su fila de hecho); no se duplican acá.
   */
  private static readonly LIFECYCLE: Record<string, string> = {
    culled: 'cull',
    lost: 'loss',
    transferred: 'transfer_out',
  };

  private lifecycleEvent(toStatus: string): string {
    const evt = AnimalStatusService.LIFECYCLE[toStatus];
    if (!evt)
      throw new BadRequestException({
        code: 'animal.invalid_status_target',
        title: `No se puede cambiar a '${toStatus}' desde aquí (venta → Ventas, muerte → Mortalidad)`,
      });
    return evt;
  }

  /** Cambio de estado de UN animal (A360 E5) — descarte/pérdida/transferencia. Reusa la regla única `transition`. */
  async changeStatus(animalId: string, opts: { toStatus: string; reason?: string; occurredAt?: string }): Promise<AnimalTransitionResult> {
    const evt = this.lifecycleEvent(opts.toStatus);
    return this.db.tx(async (q) => {
      const hlc = this.serverClock.tick();
      return this.transition(q, {
        animalId,
        toStatus: opts.toStatus,
        timelineEventType: evt,
        payload: opts.reason ? { reason: opts.reason } : {},
        originRef: `status:${animalId}:${hlc}`,
        emitServerOrigin: true,
        hlc,
        occurredAt: opts.occurredAt,
      });
    });
  }

  /**
   * Cambio de estado MASIVO (A360 E5): descarta/pierde/transfiere una selección. Idempotente y
   * resiliente — los que no están activos se cuentan como omitidos (no aborta el lote).
   */
  async bulkChangeStatus(animalIds: string[], opts: { toStatus: string; reason?: string }): Promise<{ changed: number; skipped: number }> {
    const evt = this.lifecycleEvent(opts.toStatus);
    const ids = [...new Set((animalIds ?? []).filter((x) => typeof x === 'string'))];
    if (!ids.length) throw new BadRequestException({ code: 'status.empty', title: 'Sin animales seleccionados' });
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const active = await q.query<{ id: string }>(
        `SELECT id FROM animals WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
        [ids, t],
      );
      let changed = 0;
      for (const a of active) {
        const hlc = this.serverClock.tick();
        await this.transition(q, {
          animalId: a.id,
          toStatus: opts.toStatus,
          timelineEventType: evt,
          payload: opts.reason ? { reason: opts.reason } : {},
          originRef: `status:${a.id}:${hlc}`,
          emitServerOrigin: true,
          hlc,
        });
        changed++;
      }
      return { changed, skipped: ids.length - changed };
    });
  }
}
