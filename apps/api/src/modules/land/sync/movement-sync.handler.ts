import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { MovementService, type MovementIntent } from '../movement.service';

/**
 * animal_movements: canal de sync ENTRANTE del movimiento de hacienda (P3 M-1.c).
 * El móvil captura un movimiento offline y lo emite como UN `event` op que lleva la
 * INTENCIÓN con contexto (`to_lot_id`/`to_paddock_id`/`reason`/`moved_at`), no dos
 * `put` de campo anónimos. Este handler mapea esa intención a la REGLA ÚNICA
 * `MovementService.recordMovement` (origin='sync') — que fija el campo por LWW en
 * sync_row_state, el hecho y el timeline; no reimplementa nada.
 *
 * Vive en `land/` (ADR-0008: el handler pertenece al módulo dueño del dominio, nunca
 * a `sync/`). Se auto-registra en el `SyncHandlerRegistry` al arrancar.
 *
 * Idempotencia por `movementId = op.rowId` (índice único + omisión en recordMovement).
 * `emitServerOrigin:false`: el changeset del device ya re-propaga el `event` op al
 * resto de dispositivos por pull; el servidor no re-emite.
 *
 * Rechazo de dominio → CONFLICTO (no throw): si el movimiento entrante es incoherente
 * (lote no pertenece al potrero, lote/potrero inexistente, sin destino), NO se lanza
 * —lanzar abortaría todo el changeset— sino que se reporta un `SyncConflict`
 * semántico para revisión y no se aplica. Los errores inesperados sí se relanzan.
 */
const DOMAIN_REJECTIONS = new Set(['movement.lot_paddock_mismatch', 'lot.not_found', 'paddock.not_found', 'movement.noop']);

@Injectable()
export class MovementSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'animal_movements' as const;

  constructor(
    private readonly db: DbService,
    private readonly movement: MovementService,
    private readonly registry: SyncHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op): Promise<SyncConflict[]> {
    if (op.kind !== 'event') {
      throw new BadRequestException({ code: 'sync.unsupported_op', title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}` });
    }
    const row = op.row;
    const animalId = row['animal_id'] as string | undefined;
    if (!animalId) {
      return [{ type: 'semantic', entity_id: op.rowId, detail: 'Movimiento sin animal_id' }];
    }

    // Tripartición por PRESENCIA de clave: ausente = sin cambio; null = limpiar; uuid = asignar.
    const to: MovementIntent = {};
    if ('to_lot_id' in row) to.lot = (row['to_lot_id'] as string | null) ?? null;
    if ('to_paddock_id' in row) to.paddock = (row['to_paddock_id'] as string | null) ?? null;

    try {
      await this.movement.recordMovement(q, {
        animalIds: [animalId],
        to,
        reason: (row['reason'] as string) ?? 'movimiento',
        movedAt: (row['moved_at'] as string) ?? undefined,
        actorUserId: this.db.user,
        origin: 'sync',
        movementId: op.rowId, // clave de idempotencia (event id del device)
        hlc: op.hlc,
        emitServerOrigin: false, // el changeset del device ya se re-propaga por pull
      });
      return [];
    } catch (e) {
      if (e instanceof BadRequestException) {
        const resp = e.getResponse() as { code?: string };
        if (resp?.code && DOMAIN_REJECTIONS.has(resp.code)) {
          // Incoherencia → conflicto para revisión; no se aplica, no se aborta el changeset.
          return [{ type: 'semantic', entity_id: animalId, detail: `Movimiento rechazado: ${resp.code}` }];
        }
      }
      throw e;
    }
  }
}
