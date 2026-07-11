import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Reclamo de batches para el procesador de importación (P2 P-c.1). ÚNICO lugar
 * autorizado a fijar el GUC `app.job_scope='import_worker'` (la excepción de
 * descubrimiento de la política RLS de `import_batches`, oleada 2.4). NO se
 * agrega una capacidad privilegiada genérica a `DbService`.
 *
 * Contrato (aprobado): transacción PRIVILEGIADA aislada — fija `app.job_scope`,
 * reclama UN batch atómicamente con `FOR UPDATE SKIP LOCKED`, devuelve SOLO
 * `id` + `tenantId`, y termina. NO instala `requestContext`, NO lee campos
 * sensibles (mapping/filename/file_ref), NO procesa filas. Como `SET LOCAL` es
 * scope de transacción, al cerrar la tx el bypass desaparece: cualquier trabajo
 * posterior corre en una transacción nueva y limpia, tenant-scoped, bajo RLS
 * normal (lo hace el procesador en P-c.2).
 */
@Injectable()
export class ImportClaimRepository {
  /** Un batch en `processing` con heartbeat más viejo que esto se considera huérfano y se re-reclama. */
  private static readonly STALE_HEARTBEAT = "interval '2 minutes'";

  constructor(private readonly db: DbService) {}

  /**
   * Reclama el próximo batch pendiente (`queued`, o `processing` huérfano por
   * caída) y lo transiciona a `processing`/`phase='create'`. Devuelve `id` y
   * `tenantId`, o `null` si no hay trabajo. Corre fuera de request → `db.tx`
   * abre una transacción propia.
   */
  async claimNext(): Promise<{ id: string; tenantId: string } | null> {
    return this.db.tx(async (q) => {
      // Excepción de descubrimiento (solo dentro de esta tx). SET LOCAL vía set_config(..., true).
      await q.query(`SELECT set_config('app.job_scope', 'import_worker', true)`);
      const row = await q.one<{ id: string; tenant_id: string }>(
        `UPDATE import_batches
           SET status = 'processing', phase = 'create', heartbeat_at = now(),
               started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = (
           SELECT id FROM import_batches
           WHERE status = 'queued'
              OR (status = 'processing' AND heartbeat_at < now() - ${ImportClaimRepository.STALE_HEARTBEAT})
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, tenant_id`,
      );
      return row ? { id: row.id, tenantId: row.tenant_id } : null;
    });
  }
}
