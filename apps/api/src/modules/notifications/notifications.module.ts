import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { PushDeliveryClaimRepository } from './push-delivery-claim.repository';
import { PushProcessor } from './push.processor';
import { PUSH_TRANSPORT } from './push-transport.port';
import { PUSH_RUNTIME_CONFIG, type PushRuntimeConfig, parsePushEnabled } from './push-runtime-config';
import { buildPushTransport } from './push-transport.factory';

/**
 * Notificaciones (P7): ledger de entrega + envío push. `NotificationService` despacha desde
 * `alerts` hacia `notifications`/`notification_deliveries`; `PushProcessor` envía las entregas.
 *
 * Wiring seguro (P7-3.c.2): un ÚNICO provider por token, resuelto por factory que lee el env
 * una vez al arrancar. `PUSH_RUNTIME_CONFIG` parsea `PUSH_ENABLED` (boot falla si es malformado);
 * `PUSH_TRANSPORT` liga `DisabledPushTransport` (deshabilitado, el poller no arranca) o
 * `ExpoPushTransport` (habilitado, sin fallback silencioso). El adapter no hace red al construirse.
 */
@Module({
  imports: [AlertsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    PushDeliveryClaimRepository,
    PushProcessor,
    { provide: PUSH_RUNTIME_CONFIG, useFactory: (): PushRuntimeConfig => ({ enabled: parsePushEnabled(process.env.PUSH_ENABLED) }) },
    { provide: PUSH_TRANSPORT, useFactory: (cfg: PushRuntimeConfig) => buildPushTransport(cfg.enabled, process.env.EXPO_PUSH_ACCESS_TOKEN), inject: [PUSH_RUNTIME_CONFIG] },
  ],
})
export class NotificationsModule {}
