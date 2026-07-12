import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';

/**
 * Notificaciones (P7): ledger de entrega por usuario. `NotificationService` despacha desde el
 * inbox `alerts` (reusa `AlertsService`) hacia `notifications`. Arista notifications→alerts
 * unidireccional (0 ciclos). El transporte push llega en una fase posterior.
 */
@Module({
  imports: [AlertsModule],
  controllers: [NotificationsController],
  providers: [NotificationService],
})
export class NotificationsModule {}
