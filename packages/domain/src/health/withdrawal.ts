/**
 * Determina la fecha de retiro obligatorio (carne y leche) de un producto
 * veterinario aplicado a un animal.
 *
 * "Retiro" (withdrawal): período tras aplicar un tratamiento durante el cual
 * el producto (carne o leche) del animal no puede comercializarse.
 *
 * Función pura: aritmética de fechas determinista, sin I/O, sin catálogo,
 * sin tenant. Extraída de `health.service.ts`/`SyncContext.tsx` (F0 golden:
 * `docs/golden/business-rules.md`, reglas 1 y 2) — mismo comportamiento,
 * un solo lugar.
 */

import { addFarmDays, asFarmDate } from '../time/farm-date';

const HOUR_MS = 3600000;

export interface WithdrawalResult {
  /** Fecha (sin hora) hasta la que rige el retiro de carne, o null si no aplica. */
  meatWithdrawalUntil: string | null;
  /** Timestamp completo (conserva la hora) hasta el que rige el retiro de leche, o null si no aplica. */
  milkWithdrawalUntil: string | null;
}

/**
 * El retiro de CARNE se cuenta en días de CALENDARIO, y el calendario es el de la finca.
 *
 * Antes se calculaba con `toISOString()`, que es UTC siempre. Un tratamiento aplicado a las 20:30 en
 * Venezuela ya es «mañana» en Greenwich, así que los días se contaban desde el día siguiente: el
 * retiro terminaba un día TARDE. Molesto, pero del lado seguro.
 *
 * **Del otro lado del meridiano el error se da vuelta y deja de ser molesto.** En una finca en
 * UTC+9, un tratamiento de las 08:00 todavía es «ayer» en UTC, y el retiro terminaba un día ANTES
 * de lo debido: carne con residuos habilitada para vender. La app se registra con país, y los
 * países soportados no son todos del mismo lado.
 *
 * El retiro de LECHE es distinto y por eso no cambia: se cuenta en HORAS y devuelve un instante.
 * Un instante más horas es un instante — ahí no hay calendario que interpretar.
 *
 * **Una fecha pelada no se convierte.** Si llega `2026-06-01` —lo que manda un formulario—, ese es
 * el día y punto: pasarla por una zona la leería como medianoche UTC y en América retrocedería al
 * 31 de mayo. Si llega un INSTANTE completo, ése sí se convierte, porque un instante sí depende de
 * dónde se lo mire. Es la misma distinción que hace `asFarmDate`, y por eso se reusa en vez de
 * reimplementarla.
 *
 * @param appliedAt fecha/hora en que se aplicó el tratamiento. Fecha calendario o instante.
 * @param withdrawalMeatDays días de retiro de carne del producto (0/null → sin retiro).
 * @param withdrawalMilkHours horas de retiro de leche del producto (0/null → sin retiro).
 * @param timeZone zona de la finca. Sin ella cae a UTC, que es el comportamiento viejo.
 */
export function computeWithdrawal(
  appliedAt: Date | string,
  withdrawalMeatDays: number | null,
  withdrawalMilkHours: number | null,
  timeZone = 'UTC',
): WithdrawalResult {
  const meatWithdrawalUntil = withdrawalMeatDays
    ? addFarmDays(asFarmDate(appliedAt, timeZone), withdrawalMeatDays)
    : null;
  const milkWithdrawalUntil = withdrawalMilkHours
    ? new Date(new Date(appliedAt).getTime() + withdrawalMilkHours * HOUR_MS).toISOString()
    : null;
  return { meatWithdrawalUntil, milkWithdrawalUntil };
}
