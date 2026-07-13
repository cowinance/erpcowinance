import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { PushDeliveryClaimRepository, type ClaimedDelivery } from './push-delivery-claim.repository';
import { PUSH_TRANSPORT, PushTransportRequestError, type PushSendResult, type PushTransport } from './push-transport.port';
import { PUSH_RUNTIME_CONFIG, type PushRuntimeConfig } from './push-runtime-config';
import { buildPushMessageData } from './push-message.contract';

const CLAIM_BATCH = 50;
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 30_000;
const BACKOFF_BASE_SEC = 60;
const BACKOFF_CAP_SEC = 3600;

/** Backoff exponencial acotado y DETERMINISTA (sin jitter): 60,120,240,480,960,…≤3600 s. */
function backoffSeconds(attempt: number): number {
  return Math.min(BACKOFF_BASE_SEC * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_SEC);
}

interface PrepRow {
  status: string;
  token_snapshot: string;
  sync_device_id: string;
  attempt_count: number;
  notif_id: string | null;
  channel: string | null;
  notif_user: string | null;
  title: string;
  body: string | null;
  related_type: string | null;
  related_id: string | null;
  device_id: string | null;
  device_user: string | null;
  device_token: string | null;
}
interface Sendable {
  deliveryId: string;
  deviceId: string;
  token: string;
  title: string;
  body: string | null;
  attemptCount: number;
  notificationId: string;
  relatedType: string | null;
  relatedId: string | null;
}

/**
 * Procesador de entregas push (P7-3.b). Envía por ENTREGA (notification_deliveries), no por
 * notificación lógica. Fases estrictamente separadas (nunca red dentro de una tx):
 *  1) claim privilegiado (PushDeliveryClaimRepository, `app.job_scope`) → ids + tenant;
 *  2) preparación TENANT-SCOPED (valida device/token/notif, carga el mensaje, persiste los
 *     fallos de preflight);
 *  3) `PushTransport.send()` FUERA de tx;
 *  4) persistencia TENANT-SCOPED de resultados (estado por entrega, limpieza condicional del
 *     token, y recálculo del resumen de cada notificación).
 *
 * `processing_at` es un LEASE (recuperación de huérfanas), no exactly-once: el envío externo
 * es at-least-once. Deshabilitado por defecto (`PUSH_ENABLED=false`): el poller NO arranca y
 * `DisabledPushTransport.send()` lanza — no se procesan entregas hasta P7-3.c (adapter Expo).
 */
@Injectable()
export class PushProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushProcessor.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  private readonly enabled: boolean;

  constructor(
    private readonly db: DbService,
    private readonly claims: PushDeliveryClaimRepository,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport,
    @Inject(PUSH_RUNTIME_CONFIG) config: PushRuntimeConfig,
  ) {
    this.enabled = config.enabled; // decisión explícita del wiring (no lee process.env)
  }

  onModuleInit(): void {
    if (this.enabled) this.timer = setInterval(() => void this.processTick(), POLL_INTERVAL_MS);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Un tick: reclama un lote cross-tenant y procesa cada tenant por separado. Público para test determinista. */
  async processTick(): Promise<{ claimed: number }> {
    if (this.draining) return { claimed: 0 };
    this.draining = true;
    try {
      const claimed = await this.claims.claimBatch(CLAIM_BATCH);
      if (!claimed.length) return { claimed: 0 };
      const byTenant = new Map<string, ClaimedDelivery[]>();
      for (const c of claimed) {
        const arr = byTenant.get(c.tenantId);
        if (arr) arr.push(c);
        else byTenant.set(c.tenantId, [c]);
      }
      for (const [tenantId, list] of byTenant) await this.processTenant(tenantId, list);
      return { claimed: claimed.length };
    } finally {
      this.draining = false;
    }
  }

  /** tx propia + SET LOCAL app.tenant_id + requestContext.run. Privado (no una capacidad genérica en DbService). */
  private async withTenant<T>(tenantId: string, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return requestContext.run({ tenantId, userId: '', role: 'system', q }, () => fn(q));
    });
  }

  private async processTenant(tenantId: string, claimed: ClaimedDelivery[]): Promise<void> {
    // Fase 2: preparación tenant-scoped.
    const prep = await this.withTenant(tenantId, async (q) => {
      const sendable: Sendable[] = [];
      const affected = new Set<string>();
      for (const c of claimed) {
        affected.add(c.notificationId);
        const r = await q.one<PrepRow>(
          `SELECT d.status, d.token_snapshot, d.sync_device_id, d.attempt_count,
                  n.id AS notif_id, n.channel, n.user_id AS notif_user, n.title, n.body,
                  a.related_type, a.related_id,
                  sd.id AS device_id, sd.user_id AS device_user, sd.push_token AS device_token
           FROM notification_deliveries d
           LEFT JOIN notifications n ON n.id = d.notification_id AND n.tenant_id = d.tenant_id
           LEFT JOIN alerts a ON a.id = n.alert_id AND a.tenant_id = d.tenant_id
           LEFT JOIN sync_devices sd ON sd.id = d.sync_device_id AND sd.tenant_id = d.tenant_id AND sd.deleted_at IS NULL
           WHERE d.id = $1 AND d.tenant_id = $2`,
          [c.deliveryId, tenantId],
        );
        if (!r || r.status !== 'queued') continue; // desaparecida o ya terminal → ignorar
        const fail = this.preflightError(r);
        if (fail) {
          // Fallo permanente de preflight: NO cuenta como intento externo (attempt_count intacto).
          await q.query(
            `UPDATE notification_deliveries SET status='failed', last_error=$3, processing_at=NULL, updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND status='queued'`,
            [c.deliveryId, tenantId, fail],
          );
          continue;
        }
        sendable.push({
          deliveryId: c.deliveryId,
          deviceId: r.sync_device_id,
          token: r.token_snapshot,
          title: r.title,
          body: r.body,
          attemptCount: r.attempt_count,
          notificationId: c.notificationId,
          relatedType: r.related_type,
          relatedId: r.related_id,
        });
      }
      return { sendable, affected: [...affected] };
    });

    if (!prep.sendable.length) {
      await this.withTenant(tenantId, (q) => this.recomputeSummary(q, tenantId, prep.affected));
      return;
    }

    // Fase 3: envío FUERA de transacción.
    let results: PushSendResult[] | null = null;
    let sendError: unknown = null;
    try {
      results = await this.transport.send(
        prep.sendable.map((s) => ({
          ref: s.deliveryId,
          token: s.token,
          title: s.title,
          body: s.body,
          data: buildPushMessageData({ id: s.notificationId, related_type: s.relatedType, related_id: s.relatedId }),
        })),
      );
    } catch (e) {
      sendError = e;
      // Logging SEGURO: solo el código normalizado, nunca el error crudo/token/secreto.
      const code = e instanceof PushTransportRequestError ? e.code : 'push_transport_error';
      this.logger.warn(`push send lanzó (${code}); ${prep.sendable.length} entregas del sublote`);
    }

    // Fase 4: persistencia tenant-scoped de resultados + resumen.
    await this.withTenant(tenantId, async (q) => {
      if (sendError) {
        // Excepción COMPLETA del transporte (defensivo: otros adapters / un transporte que lance directo).
        if (sendError instanceof PushTransportRequestError && !sendError.transient) {
          for (const s of prep.sendable) await this.markPermanentFailed(q, tenantId, s, sendError.code, false); // permanente de request → failed; sin limpieza de token
        } else {
          const code = sendError instanceof PushTransportRequestError ? sendError.code : 'push_transport_error';
          for (const s of prep.sendable) await this.releaseTransient(q, tenantId, s, code); // temporal / desconocido → backoff
        }
      } else if (!results) {
        for (const s of prep.sendable) await this.releaseTransient(q, tenantId, s, 'push_transport_error');
      } else {
        const counts = new Map<string, number>();
        const byRef = new Map<string, PushSendResult>();
        for (const r of results) {
          counts.set(r.ref, (counts.get(r.ref) ?? 0) + 1);
          if (!byRef.has(r.ref)) byRef.set(r.ref, r);
        }
        const sendableIds = new Set(prep.sendable.map((s) => s.deliveryId));
        for (const ref of byRef.keys()) if (!sendableIds.has(ref)) this.logger.warn(`push: resultado con ref desconocido ${ref} (ignorado)`);
        for (const s of prep.sendable) {
          if ((counts.get(s.deliveryId) ?? 0) > 1) {
            await this.releaseTransient(q, tenantId, s, 'provider_duplicate_result');
            continue;
          }
          const r = byRef.get(s.deliveryId);
          if (!r) {
            await this.releaseTransient(q, tenantId, s, 'provider_missing_result');
          } else if (r.ok) {
            await this.markSent(q, tenantId, s);
          } else if (r.transient) {
            await this.releaseTransient(q, tenantId, s, r.providerCode ?? r.error ?? 'transient');
          } else {
            // Permanente: preserva providerCode; limpieza de token SOLO si es DeviceNotRegistered.
            await this.markPermanentFailed(q, tenantId, s, r.providerCode ?? r.error ?? 'permanent', r.error === 'DeviceNotRegistered');
          }
        }
      }
      await this.recomputeSummary(q, tenantId, prep.affected);
    });
  }

  /** Fallo permanente de preflight (device/token/notif) o null si la entrega es enviable. */
  private preflightError(r: PrepRow): string | null {
    if (!r.notif_id || r.channel !== 'push') return 'notification_invalid';
    if (!r.device_id || r.device_user !== r.notif_user) return 'device_not_found';
    if (!r.device_token) return 'token_missing';
    if (r.device_token !== r.token_snapshot) return 'token_replaced';
    return null;
  }

  private async markSent(q: Q, tenantId: string, s: Sendable): Promise<void> {
    await q.query(
      `UPDATE notification_deliveries SET status='sent', sent_at=now(), attempt_count=attempt_count+1,
              processing_at=NULL, next_attempt_at=NULL, last_error=NULL, updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [s.deliveryId, tenantId],
    );
  }

  /** Error temporal: libera con backoff; al llegar a MAX_ATTEMPTS → failed. attempt_count = intentos externos. */
  private async releaseTransient(q: Q, tenantId: string, s: Sendable, lastError: string): Promise<void> {
    const newAttempt = s.attemptCount + 1;
    if (newAttempt >= MAX_ATTEMPTS) {
      await q.query(
        `UPDATE notification_deliveries SET status='failed', attempt_count=$3, processing_at=NULL, next_attempt_at=NULL, last_error=$4, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [s.deliveryId, tenantId, newAttempt, lastError],
      );
    } else {
      await q.query(
        `UPDATE notification_deliveries SET status='queued', attempt_count=$3, processing_at=NULL,
                next_attempt_at=now() + ($5::int * interval '1 second'), last_error=$4, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [s.deliveryId, tenantId, newAttempt, lastError, backoffSeconds(newAttempt)],
      );
    }
  }

  private async markPermanentFailed(q: Q, tenantId: string, s: Sendable, lastError: string, cleanupToken: boolean): Promise<void> {
    await q.query(
      `UPDATE notification_deliveries SET status='failed', attempt_count=attempt_count+1, processing_at=NULL, last_error=$3, updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [s.deliveryId, tenantId, lastError],
    );
    if (cleanupToken) {
      // Limpieza CONDICIONAL (solo DeviceNotRegistered): nunca borra un token de reemplazo (solo si aún coincide con el snapshot).
      await q.query(`UPDATE sync_devices SET push_token=NULL, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND push_token=$3`, [s.deviceId, tenantId, s.token]);
    }
  }

  /** Resumen de la notificación push desde sus deliveries: queued > sent > failed (precedencia). */
  private async recomputeSummary(q: Q, tenantId: string, notificationIds: string[]): Promise<void> {
    if (!notificationIds.length) return;
    await q.query(
      `UPDATE notifications n SET status = CASE
         WHEN EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id=n.id AND d.tenant_id=n.tenant_id AND d.status='queued') THEN 'queued'
         WHEN EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id=n.id AND d.tenant_id=n.tenant_id AND d.status='sent')   THEN 'sent'
         ELSE 'failed' END, updated_at=now()
       WHERE n.id = ANY($1) AND n.tenant_id=$2 AND n.channel='push'`,
      [notificationIds, tenantId],
    );
  }
}
