/**
 * Contrato base de un evento de dominio: un hecho inmutable, ya ocurrido, del
 * lenguaje ubicuo ("se aplicó un tratamiento", "se registró un pesaje"). Son
 * DATOS puros — sin comportamiento, sin dependencia de infraestructura.
 *
 * La aplicación decide CUÁNDO publicar (puerto EventPublisher, en api); la
 * infraestructura decide CÓMO transportar/persistir (adaptador + outbox). El
 * dominio solo define el vocabulario. Ver ADR-0005.
 *
 * `type` identifica el evento y su versión (p. ej. `treatment.applied.v1`)
 * para poder evolucionar el esquema sin romper consumidores viejos.
 */
export interface DomainEvent {
  /** Identificador único del evento (idempotencia at-least-once en consumidores). */
  readonly eventId: string;
  /** Nombre + versión del evento, p. ej. `treatment.applied.v1`. */
  readonly type: string;
  /** Momento en que ocurrió el hecho (ISO 8601). */
  readonly occurredAt: string;
}
