import { Injectable } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import type { SyncConflict } from './sync-handler';
import type { SyncTable } from './sync-table';

/**
 * Persiste conflictos en sync_conflicts. Extraído (F6) de la duplicación
 * entre applyAnimalPut/applyPregnancyPut/applyEvent: mismo INSERT, variando
 * solo si el conflicto queda auto-resuelto (server_wins, F4.4/ADR-0007) o
 * pendiente de revisión humana en el panel de flota.
 *
 * Servicio de infraestructura chico y de un solo propósito — no un
 * "SyncHelperService" que vuelva a concentrar todo lo que F6 separa.
 */
@Injectable()
export class SyncConflictWriter {
  constructor(private readonly db: DbService) {}

  async write(q: Q, changesetDbId: string, entityType: SyncTable, conflicts: SyncConflict[]): Promise<void> {
    const t = this.db.tenant;
    for (const c of conflicts) {
      await q.query(
        c.autoResolved
          ? `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail, resolution, resolved_at)
             VALUES ($1,$2,$3,$4,$5,$6,'server_wins',now())`
          : `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail)
             VALUES ($1,$2,$3,$4,$5,$6)`,
        [t, changesetDbId, entityType, c.entity_id, c.type, c.detail],
      );
    }
  }
}
