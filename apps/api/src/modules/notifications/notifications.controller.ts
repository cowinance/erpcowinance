import { Controller, Get, Param, Post } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { NotificationService } from './notification.service';

@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly db: DbService,
  ) {}

  /** Feed del usuario. Genera notificaciones read-through (sin scheduler en P7-1). */
  @Get('notifications')
  async list() {
    await this.notifications.dispatch(this.db.user);
    return this.notifications.feed(this.db.user);
  }

  /** Contador para el badge. Read-through (genera el ledger si falta) → correcto en cualquier página. */
  @Get('notifications/unread-count')
  unreadCount() {
    return this.notifications.refreshUnreadCount(this.db.user);
  }

  @Post('notifications/:id/read')
  read(@Param('id') id: string) {
    return this.notifications.markRead(id, this.db.user);
  }
}
