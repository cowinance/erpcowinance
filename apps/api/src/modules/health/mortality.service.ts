import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HlcClock } from '@cowinance/sync-core';
import type { PutOp } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

/**
 * Núcleo NEUTRAL de mortalidad (P5-1.a). Regla y escritura ÚNICAS de la baja por
 * muerte, reutilizadas por todos los canales (REST/web y sync entrante). Cada canal
 * aporta CONTEXTO explícito (`origin`, `hlc`, `mortalityId`, `emitServerOrigin`); el
 * cuerpo no ramifica por canal ni reimplementa el cuádruple hecho+estado+versión+timeline.
 *
 * La mortalidad es una INTENCIÓN ATÓMICA (patrón P3): en una sola transacción produce
 * (1) UNA fila `mortalities`, (2) `status='dead'` + `status_changed_at` en `animals`,
 * (3) versión LWW de `status` en `sync_row_state`, (4) UN evento `death` de timeline; y,
 * para orígenes server-authored, UN changeset server-origin con el `put` de `status='dead'`
 * que converge el estado en TODOS los dispositivos (incluido el emisor: el pull entrega
 * los server-origin al propio device). Nunca se emite un `put status='dead'` suelto: el
 * cambio de estado y su hecho viajan juntos, así una intención rechazada no deja al animal
 * muerto sin registro ni timeline.
 *
 * Idempotencia por `mortalityId` (id de la fila `mortalities`): reprocesar el mismo evento
 * no crea otra mortalidad, otro timeline ni otro changeset. La columna `mortalities.animal_id`
 * es UNIQUE (una muerte por animal), refuerzo del invariante a nivel de esquema.
 *
 * Conflicto semántico (no throw en sync): si el animal no existe o YA está muerto por OTRA
 * mortalidad, se rechaza con error de dominio (`animal.not_found` / `mortality.already_dead`)
 * SIN persistencia parcial; el handler de sync lo mapea a `SyncConflict`.
 */

export type MortalityOrigin = 'rest' | 'sync';

export interface RecordMortalityInput {
  animalId: string;
  diedAt?: string;
  necropsy?: boolean;
  estimatedLoss?: number | null;
  causeDiagnosisId?: string | null;
  notes?: string | null;
  actorUserId: string;
  origin: MortalityOrigin;
  /** Clave de idempotencia = id de la fila `mortalities` (uuid en REST, op id en sync). */
  mortalityId: string;
  /** Reloj de la baja; server tick por defecto (REST). En sync = HLC del op. */
  hlc?: string;
  /** true para orígenes server-authored (REST/web) → emite changeset; el sync también emite. */
  emitServerOrigin: boolean;
}

export interface RecordMortalityResult {
  recorded: boolean;
  /** true si `mortalityId` ya estaba registrada → no-op idempotente. */
  alreadyRecorded: boolean;
  mortalityId: string;
  diedAt: string;
  tag: string | null;
  syncOps: PutOp[];
}

@Injectable()
export class MortalityService {
  private readonly serverClock = new HlcClock('server');

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly serverOrigin: ServerOriginChangesetWriter,
  ) {}

  /**
   * Registra la baja por muerte de UN animal, atómica e idempotente por `mortalityId`.
   * Rechaza (sin escritura) si el animal no existe o ya está muerto por otra mortalidad.
   */
  async recordMortality(q: Q, input: RecordMortalityInput): Promise<RecordMortalityResult> {
    const t = this.db.tenant;

    // Idempotencia: la misma operación (mismo id) ya registrada → no-op total.
    const existingByOp = await q.one<{ id: string; died_at: string }>(
      `SELECT id, died_at FROM mortalities WHERE id = $1 AND tenant_id = $2`,
      [input.mortalityId, t],
    );
    if (existingByOp) {
      return { recorded: false, alreadyRecorded: true, mortalityId: input.mortalityId, diedAt: existingByOp.died_at, tag: null, syncOps: [] };
    }

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
    if (animal.status === 'dead')
      throw new BadRequestException({ code: 'mortality.already_dead', title: `El animal ${animal.tag ?? ''} ya está registrado como muerto` });

    const diedAt = input.diedAt ?? new Date().toISOString();

    // Una muerte es un hecho, no un pronóstico. Un tipeo con fecha futura descoloca la mortalidad
    // del período y las anomalías que se calculan sobre ella.
    const hoy = await this.db.today(q);
    if (String(diedAt).slice(0, 10) > hoy)
      throw new BadRequestException({
        code: 'mortality.future_date',
        title: 'La fecha de muerte es futura. Se registra lo que ya ocurrió.',
      });
    const hlc = input.hlc ?? this.serverClock.tick();

    // (1) hecho: fila mortalities con id determinista = mortalityId. animal_id UNIQUE.
    await q.query(
      `INSERT INTO mortalities (id, tenant_id, animal_id, died_at, cause_diagnosis_id, necropsy, estimated_loss, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (animal_id) DO NOTHING`,
      [input.mortalityId, t, input.animalId, diedAt, input.causeDiagnosisId ?? null, input.necropsy ?? false, input.estimatedLoss ?? null, input.notes ?? null, input.actorUserId],
    );

    // (2) estado: status='dead' + status_changed_at.
    await q.query(`UPDATE animals SET status = 'dead', status_changed_at = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      input.animalId,
      t,
      diedAt,
    ]);

    // (3) versión LWW del campo autoritativo `status`.
    const existing = (await this.versions.read(q, 'animals', input.animalId)) ?? {};
    await this.versions.write(q, 'animals', input.animalId, { ...existing, status: hlc });

    // (4) timeline: un evento death.
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,'death',$3,$4,now(),'manual')`,
      [t, input.animalId, JSON.stringify({ cause: input.notes ?? null, origin: input.origin }), diedAt],
    );

    // (5) server-origin: converge status='dead' en todos los dispositivos (incl. emisor).
    const syncOps: PutOp[] = [{ kind: 'put', table: 'animals', rowId: input.animalId, fields: { status: 'dead' }, hlc }];
    if (input.emitServerOrigin) await this.serverOrigin.emit(q, syncOps, `mortality:${input.mortalityId}`);

    return { recorded: true, alreadyRecorded: false, mortalityId: input.mortalityId, diedAt, tag: animal.tag, syncOps };
  }
}
