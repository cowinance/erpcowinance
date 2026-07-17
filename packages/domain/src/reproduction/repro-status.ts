/**
 * Estado reproductivo de un vientre (Reproducción E1) — REGLA PURA derivada de eventos reales:
 * último parto, preñez abierta, último servicio, último diagnóstico (positivo/negativo), aborto,
 * y la configuración del rodeo (días voluntarios de espera, ventanas de diagnóstico/abierta,
 * umbral de repetidora). No hace I/O: el servicio arma los hechos y llama a esta función.
 *
 * Un solo lugar decide el estado y sus derivados (días postparto / días abiertos / días desde
 * servicio), consumido por la ficha del animal, la lista, el lote, el dashboard y las alertas.
 */

export const REPRO_STATUSES = [
  'pregnant', // preñada
  'due_soon', // próxima a parir
  'served', // servida (con servicio, sin diagnóstico aún dentro de ventana)
  'diagnosis_pending', // servida y ya pasó la ventana de diagnóstico
  'in_protocol', // en un protocolo activo (abierta)
  'aborted', // aborto/pérdida reciente
  'postpartum_rest', // en descanso postparto (antes del VWP)
  'ready_for_review', // postparto, próxima al VWP → revisar
  'ready_for_service', // elegible para servicio (VWP cumplido o vaquillona madura)
  'repeat_breeder', // repetidora: varios servicios sin preñez
  'open', // abierta demasiado tiempo (días abiertos altos)
  'empty', // vacía sin clasificación más específica
  'culled', // descartada reproductivamente
] as const;
export type ReproStatus = (typeof REPRO_STATUSES)[number];

export interface ReproConfig {
  /** Días voluntarios de espera postparto antes de habilitar servicio (p. ej. 60). */
  vwpDays: number;
  /** Ventana previa al VWP en la que la vaca queda «lista para revisión» (p. ej. 15). */
  reviewWindowDays: number;
  /** Días tras el servicio a partir de los cuales el diagnóstico está pendiente (p. ej. 45). */
  diagnosisDueDays: number;
  /** Días abiertos a partir de los cuales la vaca cuenta como «abierta demasiado tiempo» (p. ej. 90). */
  openTooLongDays: number;
  /** Servicios sin preñez a partir de los cuales es «repetidora» (p. ej. 3). */
  repeatBreederServices: number;
  /** Días previos al parto probable en que se considera «próxima a parir» (p. ej. 21). */
  calvingSoonDays: number;
  /** Días desde el aborto en que la vaca se muestra como «abortada» (p. ej. 30). */
  abortionRecentDays: number;
}

export const DEFAULT_REPRO_CONFIG: ReproConfig = {
  vwpDays: 60,
  reviewWindowDays: 15,
  diagnosisDueDays: 45,
  openTooLongDays: 90,
  repeatBreederServices: 3,
  calvingSoonDays: 21,
  abortionRecentDays: 30,
};

export interface ReproFacts {
  /** Categoría del vientre: 'vaca' (ha parido/multípara) vs 'vaquillona' (nulípara). */
  isHeifer: boolean;
  culledReproductively: boolean;
  /** Preñez abierta: fecha probable de parto (ISO date) o null si no está preñada. */
  expectedDueDate: string | null;
  lastCalvingDate: string | null;
  lastServiceDate: string | null;
  lastPositiveDiagnosisDate: string | null;
  lastNegativeDiagnosisDate: string | null;
  lastAbortionDate: string | null;
  /** Servicios registrados desde el último parto (o desde el inicio si es nulípara). */
  servicesSinceCalving: number;
  inActiveProtocol: boolean;
}

export interface ReproState {
  status: ReproStatus;
  /** Días desde el último parto (null si nunca parió). */
  daysPostpartum: number | null;
  /**
   * Días abiertos: desde el último parto hasta hoy si está abierta; null si preñada o nulípara sin
   * historial de parto. (La concepción confirmada cierra el conteo; acá el foco es la vaca abierta.)
   */
  daysOpen: number | null;
  /** Días desde el último servicio (null si no hay servicio posterior al último parto/diagnóstico). */
  daysSinceService: number | null;
  expectedDueDate: string | null;
  daysUntilDue: number | null;
  /** true si el estado habilita registrar un servicio. */
  eligibleForService: boolean;
}

const DAY_MS = 86400000;
function daysBetween(fromIso: string | null, todayIso: string): number | null {
  if (!fromIso) return null;
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const b = new Date(`${todayIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / DAY_MS);
}

/** Deriva el estado reproductivo y sus métricas a partir de los hechos + config, a la fecha `today`. */
export function computeReproStatus(facts: ReproFacts, config: ReproConfig, today: string): ReproState {
  const daysPostpartum = daysBetween(facts.lastCalvingDate, today);
  const daysUntilDue = facts.expectedDueDate != null ? daysBetween(today, facts.expectedDueDate) : null;
  const pregnant = facts.expectedDueDate != null;
  const daysOpen = !pregnant && facts.lastCalvingDate ? daysPostpartum : null;

  // ¿El último evento es un servicio posterior al último diagnóstico negativo y al último parto?
  const svc = facts.lastServiceDate ? new Date(facts.lastServiceDate).getTime() : null;
  const neg = facts.lastNegativeDiagnosisDate ? new Date(facts.lastNegativeDiagnosisDate).getTime() : null;
  const calv = facts.lastCalvingDate ? new Date(facts.lastCalvingDate).getTime() : null;
  const serviceIsLatest = svc != null && (neg == null || svc > neg) && (calv == null || svc >= calv);
  const daysSinceService = serviceIsLatest ? daysBetween(facts.lastServiceDate, today) : null;

  const base = { daysPostpartum, daysOpen, daysSinceService, expectedDueDate: facts.expectedDueDate, daysUntilDue };
  const abortDays = daysBetween(facts.lastAbortionDate, today);

  // Prioridad de resolución (primer match gana).
  let status: ReproStatus;
  let eligible = false;

  if (facts.culledReproductively) {
    status = 'culled';
  } else if (pregnant) {
    status = daysUntilDue != null && daysUntilDue <= config.calvingSoonDays ? 'due_soon' : 'pregnant';
  } else if (serviceIsLatest) {
    status = daysSinceService != null && daysSinceService >= config.diagnosisDueDays ? 'diagnosis_pending' : 'served';
  } else if (abortDays != null && abortDays <= config.abortionRecentDays) {
    status = 'aborted';
  } else if (facts.inActiveProtocol) {
    status = 'in_protocol';
    eligible = true;
  } else if (!facts.isHeifer && daysPostpartum != null && daysPostpartum < config.vwpDays) {
    // Postparto: descanso hasta la ventana de revisión, luego «lista para revisión».
    status = daysPostpartum >= config.vwpDays - config.reviewWindowDays ? 'ready_for_review' : 'postpartum_rest';
  } else if (facts.servicesSinceCalving >= config.repeatBreederServices) {
    status = 'repeat_breeder';
    eligible = true;
  } else if (daysOpen != null && daysOpen >= config.openTooLongDays) {
    status = 'open';
    eligible = true;
  } else if (facts.isHeifer && facts.servicesSinceCalving === 0 && facts.lastNegativeDiagnosisDate == null) {
    // Vaquillona sin actividad: elegible para primer servicio.
    status = 'ready_for_service';
    eligible = true;
  } else {
    // Vaca con VWP cumplido (o sin parto reciente) y abierta → lista para servicio.
    status = 'ready_for_service';
    eligible = true;
  }

  return { status, ...base, eligibleForService: eligible };
}
