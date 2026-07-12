import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { AlertsService } from '../alerts/alerts.service';

/**
 * Motor de notificaciones (P7-1). DESPACHA desde el inbox `alerts` (mantenido por
 * `AlertsService`, fuente única de reglas) hacia el ledger de entrega `notifications`, sin
 * reinventar reglas ni tocar el lifecycle de la alerta.
 *
 * Canal `in_app`: la notificación se «entrega» por EXISTIR en el feed → nace con
 * `status='delivered'` (no `queued`, que es estado de un transporte real). El estado de
 * LECTURA es aparte: `delivered → read` al abrir. `queued`/`sent`/`failed` se reservan para
 * canales con transporte (push, fase posterior).
 *
 * Idempotencia: índice único parcial `(tenant, user, channel, alert_id)` → correr `dispatch`
 * dos veces no duplica. La re-notificación de una condición que reaparece ocurre cuando
 * `AlertsService.evaluate()` crea una alerta NUEVA (id nuevo, tras su ventana anti-nag);
 * durante la vida de una alerta hay exactamente una notificación por (usuario, canal).
 *
 * Destinatario (P7-1): el usuario autenticado (`db.user`) — un usuario por tenant hoy; el
 * targeting multiusuario se difiere al vertical de miembros.
 */

/** Categorías notificables: acciones de campo del hato. Excluye las de sistema (sync). */
const NOTIFIABLE_CATEGORIES = ['health', 'reproduction'];

export interface NotificationDto {
  id: string;
  title: string;
  body: string | null;
  status: string;
  read_at: string | null;
  created_at: string;
  alert_id: string | null;
  related_type: string | null;
  related_id: string | null;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly db: DbService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Genera notificaciones `in_app` (`delivered`) desde las alertas ABIERTAS notificables del
   * tenant para `userId`. Refresca `alerts` vía `evaluate()` (una sola fuente). Idempotente
   * por el índice único. No modifica el lifecycle de la alerta.
   */
  async dispatch(userId: string): Promise<{ created: number }> {
    const t = this.db.tenant;
    await this.alerts.evaluate();
    const open = await this.db.query<{ id: string; title: string; message: string | null }>(
      `SELECT id, title, message FROM alerts
       WHERE tenant_id = $1 AND status = 'open' AND category = ANY($2) AND deleted_at IS NULL`,
      [t, NOTIFIABLE_CATEGORIES],
    );
    let created = 0;
    for (const a of open) {
      const inserted = await this.db.query(
        `INSERT INTO notifications (tenant_id, user_id, channel, title, body, alert_id, status, created_by)
         VALUES ($1,$2,'in_app',$3,$4,$5,'delivered',$2)
         ON CONFLICT (tenant_id, user_id, channel, alert_id) WHERE alert_id IS NOT NULL AND deleted_at IS NULL
         DO NOTHING
         RETURNING id`,
        [t, userId, a.title, a.message, a.id],
      );
      if (inserted.length) created++;
    }
    return { created };
  }

  /** Feed del usuario autenticado: orden determinista (fecha desc, id desc). */
  async feed(userId: string): Promise<NotificationDto[]> {
    const t = this.db.tenant;
    return this.db.query<NotificationDto>(
      `SELECT n.id, n.title, n.body, n.status, n.read_at, n.created_at, n.alert_id,
              a.related_type, a.related_id
       FROM notifications n
       LEFT JOIN alerts a ON a.id = n.alert_id
       WHERE n.tenant_id = $1 AND n.user_id = $2 AND n.channel = 'in_app' AND n.deleted_at IS NULL
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 100`,
      [t, userId],
    );
  }

  /**
   * Marca una notificación como leída (`delivered → read`, sella `read_at`). `read → read` es
   * no-op. Aislado por tenant + usuario: no puede marcar la de otro usuario (→ not_found).
   */
  async markRead(id: string, userId: string): Promise<{ id: string; status: string }> {
    const t = this.db.tenant;
    const updated = await this.db.one<{ status: string }>(
      `UPDATE notifications SET status = 'read', read_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND channel = 'in_app' AND status = 'delivered' AND deleted_at IS NULL
       RETURNING status`,
      [id, t, userId],
    );
    if (updated) return { id, status: 'read' };
    // No fue delivered: puede ser read→read (no-op) o inexistente/de otro usuario.
    const existing = await this.db.one<{ status: string }>(
      `SELECT status FROM notifications WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [id, t, userId],
    );
    if (!existing) throw new NotFoundException({ code: 'notification.not_found', title: 'Notificación no encontrada' });
    return { id, status: existing.status };
  }

  /** Cuenta las `in_app` entregadas y no leídas del usuario. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const t = this.db.tenant;
    const row = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
       WHERE tenant_id = $1 AND user_id = $2 AND channel = 'in_app' AND status = 'delivered' AND deleted_at IS NULL`,
      [t, userId],
    );
    return { count: row?.n ?? 0 };
  }
}
