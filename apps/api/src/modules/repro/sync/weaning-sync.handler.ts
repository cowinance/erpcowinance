import { BadRequestException, HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { WeaningService } from '../weaning.service';

/**
 * weanings: canal de sync ENTRANTE del destete (P5-1.c). El móvil captura el destete
 * offline y lo emite como UNA sola intención `event` (event-only) que lleva el hecho y su
 * peso opcional. Este handler mapea la intención a la REGLA ÚNICA
 * `WeaningService.recordWeaning` (origin='sync') — que en una sola tx escribe la fila
 * weanings, el pesaje asociado (si hay peso) y el timeline; no reimplementa nada.
 *
 * A diferencia de la mortalidad, el destete NO modifica ningún campo autoritativo del
 * animal → NO emite `put` ni changeset server-origin: el hecho y el pesaje se materializan
 * en el servidor (como vacunación/tratamiento). Idempotente por `weaningId = op.rowId`
 * (id de weanings + identidad determinista del pesaje asociado).
 *
 * Vive en `repro/` (ADR-0008). Se auto-registra en el `SyncHandlerRegistry` al arrancar.
 * Rechazo de dominio (animal inexistente) → `SyncConflict` semántico, sin throw (lanzar
 * abortaría todo el changeset) ni escritura parcial. Los errores inesperados se relanzan.
 */
const DOMAIN_REJECTIONS = new Set(['animal.not_found', 'weaning.missing_fields']);

@Injectable()
export class WeaningSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'weanings' as const;

  constructor(
    private readonly db: DbService,
    private readonly weaning: WeaningService,
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
      return [{ type: 'semantic', entity_id: op.rowId, detail: 'Destete sin animal_id' }];
    }

    try {
      await this.weaning.recordWeaning(q, {
        animalId,
        weaningDate: (row['weaning_date'] as string) ?? undefined,
        weightKg: (row['weight_kg'] as number | null) ?? null,
        actorUserId: this.db.user,
        origin: 'sync',
        weaningId: op.rowId, // clave de idempotencia (event id del device)
        hlc: op.hlc,
      });
      return [];
    } catch (e) {
      if (e instanceof HttpException) {
        const resp = e.getResponse() as { code?: string };
        if (resp?.code && DOMAIN_REJECTIONS.has(resp.code)) {
          return [{ type: 'semantic', entity_id: animalId, detail: `Destete rechazado: ${resp.code}` }];
        }
      }
      throw e;
    }
  }
}
