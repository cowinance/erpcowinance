import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TREATMENT_APPLIED } from '@cowinance/domain';
import type { TreatmentApplied } from '@cowinance/domain';

/**
 * Suscriptor trivial de logging (F5, ADR-0005): prueba de cableado del
 * Event Bus. No hace efectos de negocio — solo registra que el evento llegó.
 * Los consumidores reales (alertas, timeline) se migran post-F5.
 *
 * Idempotente por diseño (at-least-once): loguear dos veces el mismo evento
 * es inocuo.
 */
@Injectable()
export class LoggingSubscriber {
  private readonly logger = new Logger(LoggingSubscriber.name);

  @OnEvent(TREATMENT_APPLIED)
  onTreatmentApplied(event: TreatmentApplied): void {
    this.logger.log(
      `evento ${event.type} · treatment=${event.treatmentId} animal=${event.animalId} ` +
        `retiro_carne=${event.meatWithdrawalUntil ?? 'null'}`,
    );
  }
}
