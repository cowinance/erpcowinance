/**
 * Pasos de un protocolo reproductivo (IATF), regla ÚNICA de validación (R-2.a). Un protocolo es una
 * plantilla de pasos temporizados desde un día 0 (inicio): p. ej. día 0 implante, día 8 retiro +
 * PGF, día 10 IATF. Puro y sin I/O; se usa al crear/editar plantillas.
 */

/**
 * Tipo de paso — determina qué EVENTO REAL se registra al completarlo:
 * hormonal/device_removal → sincronización; insemination → servicio (IATF); diagnosis → diagnóstico;
 * review → revisión; other → solo la tarea. Opcional (default 'other') por compatibilidad.
 */
export const PROTOCOL_STEP_KINDS = ['hormonal', 'device_removal', 'insemination', 'diagnosis', 'review', 'other'] as const;
export type ProtocolStepKind = (typeof PROTOCOL_STEP_KINDS)[number];

export interface ProtocolStep {
  /** Offset en días desde el inicio del protocolo (entero ≥ 0). */
  day: number;
  /** Descripción de la acción (obligatoria, no vacía). */
  action: string;
  /** Tipo del paso (define el evento real al completarlo). Default 'other'. */
  kind?: ProtocolStepKind;
  /** Producto veterinario asociado (opcional). */
  product_id?: string;
  /** Nota libre (opcional). */
  notes?: string;
}

export class InvalidProtocolStepsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProtocolStepsError';
  }
}

/**
 * Valida y NORMALIZA los pasos: recorta `action`, conserva solo `product_id`/`notes` no vacíos e
 * ignora claves extra. Permite múltiples pasos el mismo día y preserva el orden de entrada. Un
 * arreglo vacío es válido (plantilla sin pasos). Lanza `InvalidProtocolStepsError` si la forma es
 * inválida.
 */
export function validateProtocolSteps(raw: unknown): ProtocolStep[] {
  if (!Array.isArray(raw)) throw new InvalidProtocolStepsError('steps debe ser un arreglo');
  return raw.map((s, i) => {
    if (!s || typeof s !== 'object') throw new InvalidProtocolStepsError(`paso ${i}: debe ser un objeto`);
    const o = s as Record<string, unknown>;
    if (!Number.isInteger(o.day) || (o.day as number) < 0) throw new InvalidProtocolStepsError(`paso ${i}: 'day' debe ser un entero ≥ 0`);
    if (typeof o.action !== 'string' || o.action.trim().length === 0) throw new InvalidProtocolStepsError(`paso ${i}: 'action' es obligatorio`);
    const step: ProtocolStep = { day: o.day as number, action: (o.action as string).trim() };
    if (o.kind != null && o.kind !== '') {
      if (!(PROTOCOL_STEP_KINDS as readonly string[]).includes(String(o.kind))) throw new InvalidProtocolStepsError(`paso ${i}: 'kind' inválido`);
      step.kind = o.kind as ProtocolStepKind;
    }
    if (typeof o.product_id === 'string' && o.product_id.length > 0) step.product_id = o.product_id;
    if (typeof o.notes === 'string' && o.notes.trim().length > 0) step.notes = (o.notes as string).trim();
    return step;
  });
}
