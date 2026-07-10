import type { Op } from '@cowinance/sync-core';
import type { Q } from '../../../db/db.service';
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
 * Un handler por tabla, dueño del módulo de dominio al que pertenece
 * (ADR-0008) — NUNCA vive en `sync/`. Interfaz TypeScript pura, cero
 * dependencia de NestJS: cualquier módulo puede referenciarla sin crear una
 * arista en el grafo de módulos.
 *
 * Deliberadamente mínima: no incluye `device`, HLC del servidor, ni acceso
 * a "repositorios" — ninguno de los handlers evaluados (animals,
 * pregnancies, treatments) los necesita como dependencia genérica.
 * `tenant`/`user` se obtienen ambient vía `DbService` inyectado en el
 * handler concreto, igual que el resto de los servicios de módulo.
 */
export interface SyncHandler {
  readonly table: SyncTable;
  apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]>;
}
