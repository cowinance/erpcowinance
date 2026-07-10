import type { Op } from '@cowinance/sync-core';
import type { Q } from '../../db/db.service';
import type { SyncTable } from './sync-table';

/**
 * Mismo shape que ya viaja en la respuesta HTTP de POST /sync/push — NO
 * renombrar `entity_id` a camelCase, es parte del contrato con el cliente.
 */
export interface SyncConflict {
  type: string;
  entity_id: string;
  detail: string;
  /** true → server_wins auto-resuelto, no espera revisión humana (ADR-0007). */
  autoResolved?: boolean;
}

/**
 * Un handler por tabla (F6, análisis en docs/sprints — ADR pendiente 0008).
 * Open/Closed: sumar una tabla al protocolo de sync es escribir un handler y
 * registrarlo — cero ediciones a SyncService.
 *
 * Interfaz deliberadamente mínima: NO incluye `device`, HLC del servidor, ni
 * acceso a "repositorios". Ninguno de los handlers evaluados (animals,
 * pregnancies, treatments) los necesita como dependencia genérica — cada
 * uno los resuelve donde realmente los usa (p. ej. el HLC del servidor es
 * interno de un futuro `PregnancySyncHandler`, no de esta interfaz).
 * `tenant`/`user` se obtienen ambient vía `DbService` inyectado en el
 * handler concreto, igual que el resto de los servicios de módulo.
 */
export interface SyncHandler {
  readonly table: SyncTable;
  apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]>;
}

export const SYNC_HANDLERS = Symbol('SYNC_HANDLERS');
