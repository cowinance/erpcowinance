import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher.port';
import { OutboxEventPublisher } from './outbox-event-publisher';
import { OutboxRelay } from './outbox.relay';
import { LoggingSubscriber } from './logging.subscriber';

/**
 * Infraestructura del Event Bus interno (ADR-0005), disponible en cualquier
 * módulo sin imports cruzados — mismo patrón @Global que DbModule /
 * SyncRegistryModule. Expone el puerto `EventPublisher` (token EVENT_PUBLISHER)
 * implementado por el adaptador outbox-backed; los servicios de aplicación
 * inyectan el puerto, nunca la infra concreta.
 *
 * Se importa UNA sola vez, en AppModule.
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    { provide: EVENT_PUBLISHER, useClass: OutboxEventPublisher },
    OutboxRelay,
    LoggingSubscriber,
  ],
  exports: [EVENT_PUBLISHER],
})
export class EventBusModule {}
