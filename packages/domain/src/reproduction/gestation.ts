/**
 * Estima la fecha probable de parto de una hembra preñada (bovino).
 *
 * "Gestación" (gestation): duración fija por especie entre el servicio
 * reproductivo (o el diagnóstico) y el parto — 283 días para bovino (fijo
 * hoy; a futuro parametrizable por `species.gestation_days`, ver
 * docs/golden/business-rules.md regla 3).
 *
 * Dos modos, deliberadamente DOS funciones (no una con una rama oculta):
 * un parámetro opcional que decide internamente la fórmula esconde una
 * decisión de negocio real. Los nombres hacen explícita la semántica.
 *
 * Funciones puras: aritmética de fechas determinista, sin I/O. Extraídas de
 * `repro.service.ts`/`SyncContext.tsx` (F0 golden, regla 3; gap del Modo B
 * cerrado antes de esta extracción).
 */

const DAY_MS = 86400000;
const GESTATION_DAYS = 283; // bovino
/** Heurística: días de gestación que se asumen ya transcurridos cuando se
 *  diagnostica una preñez sin servicio registrado (p. ej. vientre comprado
 *  ya preñado). */
const ASSUMED_DAYS_ELAPSED_AT_DIAGNOSIS = 45;

/** Modo A: se conoce la fecha del servicio reproductivo que originó la preñez. */
export function computeExpectedDueDateFromService(serviceDate: Date): string {
  return new Date(serviceDate.getTime() + GESTATION_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Modo B: se diagnostica una preñez sin servicio conocido. Estima la fecha
 * de parto asumiendo `ASSUMED_DAYS_ELAPSED_AT_DIAGNOSIS` días de gestación
 * ya transcurridos al momento del diagnóstico.
 */
export function computeExpectedDueDateFromDiagnosis(diagnosisDate: Date): string {
  return new Date(diagnosisDate.getTime() + (GESTATION_DAYS - ASSUMED_DAYS_ELAPSED_AT_DIAGNOSIS) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
