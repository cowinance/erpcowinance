import type { DomainEvent } from './domain-event';

/**
 * TreatmentApplied — se aplicó un tratamiento veterinario a un animal, con sus
 * retiros ya calculados por el dominio (Server Authority, ADR-0007: el valor
 * que viaja es el canónico del servidor, no el propuesto por el cliente).
 *
 * Primer evento real del proyecto (F5, ADR-0005). Emitido hoy solo desde el
 * camino REST (`health.service.treat`); el dual-write con el handler de sync
 * queda para después.
 */
export const TREATMENT_APPLIED = 'treatment.applied.v1' as const;

export interface TreatmentApplied extends DomainEvent {
  readonly type: typeof TREATMENT_APPLIED;
  readonly treatmentId: string;
  readonly animalId: string;
  readonly productId: string;
  /** Fecha/hora de aplicación (ISO 8601). */
  readonly appliedAt: string;
  /** Retiro de carne hasta (fecha), o null si el producto no lo define. */
  readonly meatWithdrawalUntil: string | null;
  /** Retiro de leche hasta (timestamp), o null si el producto no lo define. */
  readonly milkWithdrawalUntil: string | null;
}
