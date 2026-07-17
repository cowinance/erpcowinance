/**
 * Validación de una pesada (Modo Manga E3) — regla PURA y ÚNICA, compartida por el backend
 * (errores DUROS que bloquean el guardado) y la UI de manga (advertencias + confirmación de
 * cambios extremos antes de enviar). No consulta la base; recibe el último peso como contexto.
 *
 * Tres niveles:
 *  - error   → bloquea (peso vacío/no numérico/no positivo/absurdo). `ok=false`.
 *  - warning → informa pero no bloquea (fuera de rango de la categoría, pérdida significativa).
 *  - confirm → cambio EXTREMO vs último peso: se permite pero exige confirmación explícita.
 */

export interface WeighingValidationInput {
  weightKg: number;
  /** Último peso conocido (kg), si existe. */
  lastWeightKg?: number | null;
  /** Días desde la última pesada, si se conoce (para el ritmo kg/día). */
  daysSinceLast?: number | null;
  /** Rango esperado por categoría (kg), opcional. */
  minKg?: number | null;
  maxKg?: number | null;
}

export interface WeighingIssue {
  code: string;
  message: string;
}

export interface WeighingValidationResult {
  ok: boolean; // false → error duro, no guardar
  error?: WeighingIssue;
  warnings: WeighingIssue[];
  requiresConfirm: boolean; // true → cambio extremo, pedir confirmación
  confirm?: WeighingIssue;
}

/** Cota absoluta dura: ningún bovino real supera esto; sobre esto es error de tipeo. */
export const WEIGHING_MAX_KG = 1500;
/** Banda plausible por defecto (sin categoría): fuera de esto se advierte. */
export const WEIGHING_PLAUSIBLE_MIN_KG = 20;
export const WEIGHING_PLAUSIBLE_MAX_KG = 1200;
/** Cambio porcentual vs último peso que exige confirmación. */
export const WEIGHING_EXTREME_PCT = 0.4;
/** Ritmo (kg/día) vs último peso que exige confirmación (ganancia o pérdida). */
export const WEIGHING_EXTREME_ADG = 4;
/** Pérdida porcentual que se advierte (sin bloquear). */
export const WEIGHING_LOSS_WARN_PCT = 0.12;

export function validateWeighing(input: WeighingValidationInput): WeighingValidationResult {
  const warnings: WeighingIssue[] = [];
  const w = input.weightKg;

  // ── Errores duros ──
  if (w == null || Number.isNaN(w) || !Number.isFinite(w))
    return { ok: false, error: { code: 'weight.invalid', message: 'Ingresá un peso válido' }, warnings, requiresConfirm: false };
  if (w <= 0)
    return { ok: false, error: { code: 'weight.non_positive', message: 'El peso debe ser mayor a 0' }, warnings, requiresConfirm: false };
  if (w > WEIGHING_MAX_KG)
    return { ok: false, error: { code: 'weight.absurd', message: `Peso imposible (> ${WEIGHING_MAX_KG} kg)` }, warnings, requiresConfirm: false };

  // ── Advertencias de rango ──
  const min = input.minKg ?? null;
  const max = input.maxKg ?? null;
  if (min != null && w < min) warnings.push({ code: 'weight.below_category', message: `Bajo para la categoría (mín. ${min} kg)` });
  if (max != null && w > max) warnings.push({ code: 'weight.above_category', message: `Alto para la categoría (máx. ${max} kg)` });
  if (min == null && max == null) {
    if (w < WEIGHING_PLAUSIBLE_MIN_KG) warnings.push({ code: 'weight.very_low', message: 'Peso muy bajo, revisá' });
    if (w > WEIGHING_PLAUSIBLE_MAX_KG) warnings.push({ code: 'weight.very_high', message: 'Peso muy alto, revisá' });
  }

  // ── Comparación con el último peso ──
  let requiresConfirm = false;
  let confirm: WeighingIssue | undefined;
  const last = input.lastWeightKg;
  if (last != null && last > 0) {
    const delta = w - last;
    const pct = delta / last;
    const days = input.daysSinceLast != null && input.daysSinceLast > 0 ? input.daysSinceLast : null;
    const adg = days ? delta / days : null;

    const extremePct = Math.abs(pct) >= WEIGHING_EXTREME_PCT;
    const extremeAdg = adg != null && Math.abs(adg) >= WEIGHING_EXTREME_ADG;
    if (extremePct || extremeAdg) {
      requiresConfirm = true;
      const dir = delta >= 0 ? 'subió' : 'bajó';
      confirm = {
        code: 'weight.extreme_change',
        message: `${dir} ${Math.abs(Math.round(delta))} kg (${Math.round(pct * 100)}%) vs último${adg != null ? ` · ${adg.toFixed(1)} kg/día` : ''}. ¿Confirmar?`,
      };
    } else if (pct <= -WEIGHING_LOSS_WARN_PCT) {
      warnings.push({ code: 'weight.significant_loss', message: `Bajó ${Math.abs(Math.round(delta))} kg (${Math.round(pct * 100)}%) vs último` });
    }
  }

  return { ok: true, warnings, requiresConfirm, confirm };
}
