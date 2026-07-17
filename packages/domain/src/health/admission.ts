/**
 * Internación sanitaria (Sanidad E6) — envío de un animal a un lote hospital o cuarentena. Regla
 * PURA: el tipo de internación debe coincidir con el propósito del lote destino (un lote 'hospital'
 * admite internaciones 'hospital'; uno 'quarantine', de 'quarantine'). El movimiento y la persistencia
 * los resuelve el servicio; acá solo se validan los invariantes puros.
 */

export const ADMISSION_KINDS = ['hospital', 'quarantine'] as const;
export type AdmissionKind = (typeof ADMISSION_KINDS)[number];

export class InvalidAdmissionError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'InvalidAdmissionError';
  }
}

export function assertAdmissionKind(kind: unknown): AdmissionKind {
  if (!(ADMISSION_KINDS as readonly string[]).includes(String(kind)))
    throw new InvalidAdmissionError('admission.invalid_kind', `Tipo de internación inválido: ${String(kind)}`);
  return kind as AdmissionKind;
}

/**
 * Deriva/valida el tipo de internación a partir del propósito del lote destino. Si viene un `kind`
 * explícito, debe coincidir con el propósito. Si no viene, se infiere del propósito del lote.
 */
export function resolveAdmissionKind(lotPurpose: unknown, explicitKind?: unknown): AdmissionKind {
  const purpose = String(lotPurpose ?? '');
  if (purpose !== 'hospital' && purpose !== 'quarantine')
    throw new InvalidAdmissionError('admission.lot_not_admissible', `El lote destino debe ser hospital o cuarentena (es: ${purpose || 'sin propósito'})`);
  if (explicitKind != null && explicitKind !== '') {
    const k = assertAdmissionKind(explicitKind);
    if (k !== purpose)
      throw new InvalidAdmissionError('admission.kind_mismatch', `El tipo '${k}' no coincide con el propósito del lote ('${purpose}')`);
    return k;
  }
  return purpose as AdmissionKind;
}
