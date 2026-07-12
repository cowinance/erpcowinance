import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Reclamo de entregas push para el `PushProcessor` (P7-3.b). ÚNICO lugar autorizado a fijar
 * el GUC `app.job_scope='push_worker'` (la excepción de descubrimiento de la política RLS de
 * `notification_deliveries`). NO se agrega una capacidad privilegiada genérica a `DbService`.
 *
 * Contrato: transacción PRIVILEGIADA aislada — fija `app.job_scope`, reclama un LOTE de
 * entregas elegibles con `FOR UPDATE SKIP LOCKED`, marca `processing_at=now()` (lease), y
 * devuelve SOLO `deliveryId + tenantId + notificationId`. NO instala `requestContext`, NO lee
 * título/cuerpo/token/usuario, NO llama al transporte. `SET LOCAL` es scope de tx: al cerrar,
 * el bypass desaparece y el trabajo posterior corre tenant-scoped bajo RLS normal.
 *
 * `processing_at` es un LEASE, no una garantía exactly-once: si el proceso cae tras aceptar
 * Expo el mensaje y antes de persistir `sent`, la entrega se recupera por vencimiento del
 * lease y se REENVÍA. El envío externo es at-least-once (Expo no ofrece idempotencia de app).
 */

export interface ClaimedDelivery {
  deliveryId: string;
  tenantId: string;
  notificationId: string;
}

@Injectable()
export class PushDeliveryClaimRepository {
  /** Entrega en `processing` con lease más viejo que esto → huérfana (se re-reclama). > timeout HTTP. */
  private static readonly ABANDON = "interval '5 minutes'";

  constructor(private readonly db: DbService) {}

  /** Reclama hasta `limit` entregas `queued` elegibles (o `processing` huérfanas). Fuera de request → `db.tx` abre su propia tx. */
  async claimBatch(limit: number): Promise<ClaimedDelivery[]> {
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.job_scope', 'push_worker', true)`);
      const rows = await q.query<{ id: string; tenant_id: string; notification_id: string }>(
        `UPDATE notification_deliveries SET processing_at = now(), updated_at = now()
         WHERE id IN (
           SELECT id FROM notification_deliveries
           WHERE status = 'queued'
             AND (next_attempt_at IS NULL OR next_attempt_at <= now())
             AND (processing_at IS NULL OR processing_at < now() - ${PushDeliveryClaimRepository.ABANDON})
           ORDER BY next_attempt_at NULLS FIRST, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT ${limit}
         )
         RETURNING id, tenant_id, notification_id`,
      );
      return rows.map((r) => ({ deliveryId: r.id, tenantId: r.tenant_id, notificationId: r.notification_id }));
    });
  }
}
