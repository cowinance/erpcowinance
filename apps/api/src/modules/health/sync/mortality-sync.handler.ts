import { BadRequestException, HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';
import { MortalityService } from '../mortality.service';

/**
 * mortalities: canal de sync ENTRANTE de la baja por muerte (P5-1.b). El móvil
 * captura la mortalidad offline y la emite como UNA sola intención `event` (event-only),
 * no como `event mortality` + `put status='dead'` sueltos. Este handler mapea esa
 * intención a la REGLA ÚNICA `MortalityService.recordMortality` (origin='sync') — que en
 * una sola tx escribe la fila mortalities, status='dead', la versión LWW, el timeline y el
 * changeset server-origin; no reimplementa nada.
 *
 * Vive en `health/` (ADR-0008: el handler pertenece al módulo dueño del dominio, nunca a
 * `sync/`). Se auto-registra en el `SyncHandlerRegistry` al arrancar.
 *
 * Atomicidad semántica (event-only, patrón P3): la op de mortalidad es ÚNICA — si se
 * ACEPTA, `recordMortality` escribe todo y emite UN changeset server-origin con el `put`
 * `status='dead'`, que converge el estado en TODOS los dispositivos (incluido el emisor:
 * el pull entrega los server-origin al propio device); si se RECHAZA, no se emite nada →
 * cero cambio de estado. No hay `put` compañero que pueda quedar aplicado sin hecho.
 *
 * Idempotencia por `mortalityId = op.rowId` (id de la fila mortalities + animal_id UNIQUE).
 *
 * Rechazo de dominio → CONFLICTO (no throw): si la baja entrante es incoherente (animal
 * inexistente, o ya muerto por otra mortalidad), NO se lanza —lanzar abortaría todo el
 * changeset— sino que se reporta un `SyncConflict` semántico y no se aplica. Los errores
 * inesperados sí se relanzan.
 */
const DOMAIN_REJECTIONS = new Set(['mortality.already_dead', 'animal.not_found', 'mortality.missing_fields']);

@Injectable()
export class MortalitySyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'mortalities' as const;

  constructor(
    private readonly db: DbService,
    private readonly mortality: MortalityService,
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
      return [{ type: 'semantic', entity_id: op.rowId, detail: 'Mortalidad sin animal_id' }];
    }

    try {
      await this.mortality.recordMortality(q, {
        animalId,
        diedAt: (row['died_at'] as string) ?? undefined,
        necropsy: (row['necropsy'] as boolean) ?? false,
        estimatedLoss: (row['estimated_loss'] as number | null) ?? null,
        notes: (row['notes'] as string | null) ?? null,
        actorUserId: this.db.user,
        origin: 'sync',
        mortalityId: op.rowId, // clave de idempotencia (event id del device)
        hlc: op.hlc,
        emitServerOrigin: true, // al aceptar → server-origin put converge status en todos los devices; al rechazar → nada (atómico)
      });
      return [];
    } catch (e) {
      if (e instanceof HttpException) {
        const resp = e.getResponse() as { code?: string };
        if (resp?.code && DOMAIN_REJECTIONS.has(resp.code)) {
          // Incoherencia → conflicto para revisión; no se aplica, no se aborta el changeset.
          return [{ type: 'semantic', entity_id: animalId, detail: `Mortalidad rechazada: ${resp.code}` }];
        }
      }
      throw e;
    }
  }
}
