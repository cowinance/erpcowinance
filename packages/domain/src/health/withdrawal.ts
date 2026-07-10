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

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

export interface WithdrawalResult {
  /** Fecha (sin hora) hasta la que rige el retiro de carne, o null si no aplica. */
  meatWithdrawalUntil: string | null;
  /** Timestamp completo (conserva la hora) hasta el que rige el retiro de leche, o null si no aplica. */
  milkWithdrawalUntil: string | null;
}

/**
 * @param appliedAt fecha/hora en que se aplicó el tratamiento.
 * @param withdrawalMeatDays días de retiro de carne del producto (0/null → sin retiro).
 * @param withdrawalMilkHours horas de retiro de leche del producto (0/null → sin retiro).
 */
export function computeWithdrawal(
  appliedAt: Date,
  withdrawalMeatDays: number | null,
  withdrawalMilkHours: number | null,
): WithdrawalResult {
  const meatWithdrawalUntil = withdrawalMeatDays
    ? new Date(appliedAt.getTime() + withdrawalMeatDays * DAY_MS).toISOString().slice(0, 10)
    : null;
  const milkWithdrawalUntil = withdrawalMilkHours
    ? new Date(appliedAt.getTime() + withdrawalMilkHours * HOUR_MS).toISOString()
    : null;
  return { meatWithdrawalUntil, milkWithdrawalUntil };
}
