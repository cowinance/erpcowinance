import type { DomainEvent } from '@cowinance/domain';

/**
 * Puerto de salida de la capa de aplicación (ADR-0005): "publicá este evento
 * de dominio". Los servicios de aplicación dependen SOLO de esta interfaz —
 * no conocen el outbox, ni EventEmitter2, ni el relay. El adaptador
 * (infra/event-bus) la implementa outbox-backed: `publish()` es, por debajo,
 * un registro transaccional (misma tx que el cambio de negocio). Reemplazar
 * el transporte (p. ej. Kafka) no toca este puerto ni sus emisores.
 *
 * Vive en la capa de aplicación (api), no en el dominio puro: las funciones
 * puras del dominio nunca publican — quien decide CUÁNDO publicar es la
 * aplicación.
 */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface EventPublisher {
  /**
   * Registra el evento para publicación, atómicamente con la operación de
   * negocio en curso (Outbox). Se entrega at-least-once tras el commit.
   */
  publish(event: DomainEvent): Promise<void>;
}
