import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
}
