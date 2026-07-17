/**
 * Parte de trabajo (WL-1): horas de un empleado en un día. La invariante real y única es la de las
 * HORAS — deben ser un número finito, positivo y no exceder un día natural. Se valida en el dominio
 * (ADR-0006: invariante real antes que patrón DDD) para que los tres canales compartan la misma regla.
 *
 * No hay tarifa horaria en el maestro de empleados (vive en la liquidación, H-2), por eso el costo de
 * mano de obra NO se deriva acá — queda como trabajo futuro integrando con Finanzas.
 */
export class InvalidWorkLogError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidWorkLogError';
  }
}

/** Máximo de horas imputables a un solo día (un día natural). */
export const MAX_WORK_LOG_HOURS = 24;

const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Valida las horas del parte (finitas, > 0, ≤ 24) y devuelve el valor redondeado a 3 decimales. */
export function validateWorkLogHours(hours: unknown): number {
  const h = round3(Number(hours));
  if (!Number.isFinite(h)) throw new InvalidWorkLogError('hours debe ser un número');
  if (h <= 0) throw new InvalidWorkLogError('hours debe ser mayor que 0');
  if (h > MAX_WORK_LOG_HOURS) throw new InvalidWorkLogError(`hours no puede superar ${MAX_WORK_LOG_HOURS} en un día`);
  return h;
}
