import { Injectable } from '@nestjs/common';
import { DbService, Q } from '../../../db/db.service';
import type { SyncTable } from '../contracts/sync-table';

/**
 * Persistencia de las versiones HLC por campo (LWW) en sync_row_state.
 * Extraído (F6, fase final) de la duplicación byte-idéntica entre
 * applyAnimalPut/applyPregnancyPut: mismo SELECT + mismo UPSERT, variando
 * solo el nombre de tabla.
 *
 * Separación deliberada (aprobada): el store administra SOLO la persistencia
 * del mapa de versiones. El armado del `RowState` (qué campo de dominio
 * sembrar en `fields`) queda en cada handler, porque conoce las reglas de
 * su agregado.
 *
 * Infraestructura de sync (ADR-0008): expuesta vía SyncRegistryModule
 * (@Global) para que cualquier handler de dominio la use sin acoplarse a
 * `sync.module.ts`. Servicio chico de un solo propósito — no un
 * "SyncHelperService" que reconcentre lo que F6 separa.
 */
@Injectable()
export class SyncVersionStore {
  constructor(private readonly db: DbService) {}

  /** Mapa de versiones HLC por campo de una fila, o undefined si no existe estado previo. */
  async read(q: Q, table: SyncTable, rowId: string): Promise<Record<string, string> | undefined> {
    const t = this.db.tenant;
    const stateRow = await q.one<{ versions: Record<string, string> }>(
      `SELECT versions FROM sync_row_state WHERE tenant_id = $1 AND table_name = $2 AND row_id = $3`,
      [t, table, rowId],
    );
    return stateRow?.versions;
  }

  /** Persiste (upsert) el mapa de versiones HLC por campo de una fila. */
  async write(q: Q, table: SyncTable, rowId: string, versions: Record<string, string>): Promise<void> {
    const t = this.db.tenant;
    await q.query(
      `INSERT INTO sync_row_state (tenant_id, table_name, row_id, versions)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, table_name, row_id) DO UPDATE SET versions = $4, updated_at = now()`,
      [t, table, rowId, JSON.stringify(versions)],
    );
  }
}
