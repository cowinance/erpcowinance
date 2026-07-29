/**
 * Caso clínico (Sanidad E2) — episodio sanitario de UN animal con diagnóstico, severidad,
 * tratamientos vinculados y seguimientos. Regla PURA de la máquina de estados: define los
 * estados válidos y qué transiciones se permiten. El servicio decide CUÁNDO transicionar y
 * cómo persistir (fila + evento de timeline del caso).
 */

export const CLINICAL_CASE_STATUSES = [
  'open',
  'in_treatment',
  'observation',
  'recovered',
  'referred',
  'died',
  'closed',
] as const;
export type ClinicalCaseStatus = (typeof CLINICAL_CASE_STATUSES)[number];

/** Estados en los que el caso se considera ABIERTO (cuenta para KPIs de casos activos). */
export const OPEN_CASE_STATUSES: readonly ClinicalCaseStatus[] = ['open', 'in_treatment', 'observation'];

export const CLINICAL_CASE_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type ClinicalCaseSeverity = (typeof CLINICAL_CASE_SEVERITIES)[number];

export const CLINICAL_CASE_OUTCOMES = ['recovered', 'referred', 'died', 'culled', 'other'] as const;
export type ClinicalCaseOutcome = (typeof CLINICAL_CASE_OUTCOMES)[number];

/**
 * Transiciones permitidas. `closed` es terminal (no sale de él). `died` sólo puede cerrarse.
 * Los demás estados admiten avanzar/retroceder (recaídas) o cerrarse.
 */
export const CLINICAL_CASE_TRANSITIONS: Record<ClinicalCaseStatus, readonly ClinicalCaseStatus[]> = {
  open: ['in_treatment', 'observation', 'recovered', 'referred', 'died', 'closed'],
  in_treatment: ['observation', 'recovered', 'referred', 'died', 'closed'],
  observation: ['in_treatment', 'recovered', 'referred', 'died', 'closed'],
  recovered: ['in_treatment', 'observation', 'closed'],
  referred: ['in_treatment', 'observation', 'recovered', 'died', 'closed'],
  died: ['closed'],
  closed: [],
};

export class InvalidClinicalCaseError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'InvalidClinicalCaseError';
  }
}

export function assertCaseStatus(status: unknown): ClinicalCaseStatus {
  if (!(CLINICAL_CASE_STATUSES as readonly string[]).includes(String(status)))
    throw new InvalidClinicalCaseError('clinical_case.invalid_status', `Estado de caso inválido: ${String(status)}`);
  return status as ClinicalCaseStatus;
}

export function assertCaseSeverity(severity: unknown): ClinicalCaseSeverity | null {
  if (severity == null || severity === '') return null;
  if (!(CLINICAL_CASE_SEVERITIES as readonly string[]).includes(String(severity)))
    throw new InvalidClinicalCaseError('clinical_case.invalid_severity', `Severidad inválida: ${String(severity)}`);
  return severity as ClinicalCaseSeverity;
}

export function assertCaseOutcome(outcome: unknown): ClinicalCaseOutcome | null {
  if (outcome == null || outcome === '') return null;
  if (!(CLINICAL_CASE_OUTCOMES as readonly string[]).includes(String(outcome)))
    throw new InvalidClinicalCaseError('clinical_case.invalid_outcome', `Resultado inválido: ${String(outcome)}`);
  return outcome as ClinicalCaseOutcome;
}

/** Valida la transición de estado; lanza si `from` es terminal o `to` no es alcanzable. */
export function assertCaseTransition(from: ClinicalCaseStatus, to: ClinicalCaseStatus): void {
  if (from === to) return; // idempotente: re-poner el mismo estado no es un error
  const allowed = CLINICAL_CASE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to))
    throw new InvalidClinicalCaseError('clinical_case.invalid_transition', `Transición de caso no permitida: ${from} → ${to}`);
}

export function isOpenCaseStatus(status: ClinicalCaseStatus): boolean {
  return OPEN_CASE_STATUSES.includes(status);
}

/**
 * ¿Es un estado del que ya no se sale?
 *
 * Se DERIVA de la tabla de transiciones en vez de listar los estados a mano: si mañana `closed`
 * dejara de ser terminal —o apareciera otro que sí lo es— esto lo sigue sin que nadie se acuerde de
 * tocar dos lugares. Es la misma razón por la que el piso del intervalo entre partos es la gestación
 * y no un número aparte.
 */
export function isTerminalCaseStatus(status: ClinicalCaseStatus): boolean {
  return (CLINICAL_CASE_TRANSITIONS[status] ?? []).length === 0;
}

/**
 * Un caso terminado no admite más actividad.
 *
 * La máquina de estados ya decía que `closed` es terminal, pero solo la miraba el cambio de estado:
 * un seguimiento que traía únicamente una NOTA no consultaba nada, y se podía seguir anotando sobre
 * un caso cerrado para siempre. Y no quedaba en un rincón: cada nota escribe en la línea de tiempo
 * del ANIMAL como «seguimiento de caso clínico», así que la ficha mostraba movimiento de un caso que
 * el productor había dado por terminado — y en el historial del caso aparecían hechos posteriores a
 * su cierre.
 *
 * Cerrar es una afirmación: «esto terminó, con este resultado». Si se le puede seguir agregando, no
 * afirma nada.
 *
 * Ojo con lo que NO entra acá: `died` no es terminal —todavía puede cerrarse— y eso es a propósito,
 * porque el resultado de una necropsia llega después de la muerte y tiene que poder anotarse.
 */
export function assertCaseAcceptsActivity(status: ClinicalCaseStatus): void {
  if (isTerminalCaseStatus(status))
    throw new InvalidClinicalCaseError(
      'clinical_case.closed',
      'El caso está cerrado y no admite más seguimientos. Si el animal volvió a enfermar, abrí un caso nuevo.',
    );
}
