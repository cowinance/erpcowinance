import { Injectable } from '@nestjs/common';
import type { SyncHandler } from '../contracts/sync-handler.interface';
import type { SyncTable } from '../contracts/sync-table';

/**
 * Resuelve el handler de una tabla por su nombre. Open/Closed a nivel de
 * módulo (ADR-0008): cada handler se **auto-registra** desde su propio
 * módulo de dominio (`OnModuleInit` → `registry.register(this)`) — este
 * registry no conoce, ni necesita conocer, qué módulos existen.
 *
 * Falla en el arranque (no en runtime) si dos handlers reclaman la misma
 * tabla — red de seguridad barata contra un error de registro.
 */
@Injectable()
export class SyncHandlerRegistry {
  private readonly byTable = new Map<SyncTable, SyncHandler>();

  register(handler: SyncHandler): void {
    if (this.byTable.has(handler.table)) {
      throw new Error(`SyncHandlerRegistry: dos handlers registrados para la tabla '${handler.table}'`);
    }
    this.byTable.set(handler.table, handler);
  }

  get(table: string): SyncHandler | undefined {
    return this.byTable.get(table as SyncTable);
  }
}
