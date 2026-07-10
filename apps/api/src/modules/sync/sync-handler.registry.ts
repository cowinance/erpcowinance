import { Inject, Injectable } from '@nestjs/common';
import { SYNC_HANDLERS } from './sync-handler';
import type { SyncHandler } from './sync-handler';
import type { SyncTable } from './sync-table';

/**
 * Resuelve el handler de una tabla por su nombre. Open/Closed (F6): sumar un
 * handler a los providers de SYNC_HANDLERS es la única edición necesaria
 * para soportar una tabla nueva — cero cambios acá ni en SyncService.
 *
 * Falla en el arranque (no en runtime) si dos handlers reclaman la misma
 * tabla — red de seguridad barata contra un error de registro.
 */
@Injectable()
export class SyncHandlerRegistry {
  private readonly byTable = new Map<SyncTable, SyncHandler>();

  constructor(@Inject(SYNC_HANDLERS) handlers: SyncHandler[]) {
    for (const h of handlers) {
      if (this.byTable.has(h.table)) {
        throw new Error(`SyncHandlerRegistry: dos handlers registrados para la tabla '${h.table}'`);
      }
      this.byTable.set(h.table, h);
    }
  }

  get(table: string): SyncHandler | undefined {
    return this.byTable.get(table as SyncTable);
  }
}
