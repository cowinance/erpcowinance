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

  /**
   * Cuántas veces se reintenta un lote antes de darlo por perdido.
   *
   * Tres: un error transitorio —una caída del proceso, un bloqueo— se resuelve en el primer o
   * segundo reintento; uno determinista, como una fila que la base rechaza, va a fallar siempre.
   * Sin tope, ese segundo caso reintentaba cada dos minutos indefinidamente y el productor veía
   * «procesando…» sin ningún error. Reintentar para siempre no es tolerancia a fallos: es esconder
   * el fallo.
   */
  static readonly MAX_ATTEMPTS = 3;

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
               attempts = attempts + 1,
               started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = (
           SELECT id FROM import_batches
           WHERE (status = 'queued'
              OR (status = 'processing' AND heartbeat_at < now() - ${ImportClaimRepository.STALE_HEARTBEAT}))
             -- Un lote que ya agotó los intentos no se vuelve a reclamar: lo cierra noteFailure.
             AND attempts < ${ImportClaimRepository.MAX_ATTEMPTS}
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, tenant_id`,
      );
      return row ? { id: row.id, tenantId: row.tenant_id } : null;
    });
  }

  /**
   * Anota el fallo y, si ya no quedan intentos, cierra el lote en `failed`.
   *
   * El motivo se GUARDA, no se deja solo en los logs: el productor tiene que poder abrir su
   * importación y leer por qué murió. Un lote trabado en «procesando» sin explicación es
   * indistinguible de uno que tarda.
   *
   * Corre en su propia transacción, fuera de la del chunk que acaba de revertirse — si fuera la
   * misma, el rollback se llevaría también esta anotación y el fallo volvería a ser invisible.
   */
  async noteFailure(batchId: string, message: string): Promise<{ gaveUp: boolean }> {
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.job_scope', 'import_worker', true)`);
      const row = await q.one<{ agotado: boolean }>(
        `UPDATE import_batches
            SET last_error = $2,
                status = CASE WHEN attempts >= ${ImportClaimRepository.MAX_ATTEMPTS} THEN 'failed' ELSE status END,
                finished_at = CASE WHEN attempts >= ${ImportClaimRepository.MAX_ATTEMPTS} THEN now() ELSE finished_at END,
                updated_at = now()
          WHERE id = $1
        RETURNING (status = 'failed') AS agotado`,
        [batchId, message.slice(0, 2000)],
      );
      return { gaveUp: row?.agotado ?? false };
    });
  }
}
