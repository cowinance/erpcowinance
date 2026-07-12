import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { PushDeliveryClaimRepository } from './push-delivery-claim.repository';
import { PushProcessor } from './push.processor';
import { PUSH_TRANSPORT } from './push-transport.port';
import { DisabledPushTransport } from './disabled-push-transport';

/**
 * Notificaciones (P7): ledger de entrega por usuario. `NotificationService` despacha desde el
 * inbox `alerts` (reusa `AlertsService`) hacia `notifications`/`notification_deliveries`.
 * `PushProcessor` envía las entregas push, pero DESHABILITADO por defecto: `PUSH_ENABLED=false`
 * → el poller no arranca y `PUSH_TRANSPORT` liga `DisabledPushTransport` (lanza si se invoca).
 * El adapter real (Expo) y la habilitación llegan en P7-3.c. Arista notifications→alerts
 * unidireccional (0 ciclos).
 */
@Module({
  imports: [AlertsModule],
  controllers: [NotificationsController],
  providers: [NotificationService, PushDeliveryClaimRepository, PushProcessor, { provide: PUSH_TRANSPORT, useClass: DisabledPushTransport }],
})
export class NotificationsModule {}
