/**
 * Reglas del comprobante fiscal (G4-4): qué se puede emitir, qué se puede anular y qué puede
 * referenciar una nota. Puras, sin base — las mismas que aplican la API y la UI.
 */
import type { FiscalDocumentType } from './numbering';

/** Estado de un comprobante ya emitido. No hay «borrador»: emitir consume un número. */
export type FiscalDocumentStanding = 'issued' | 'voided';

export class FiscalDocumentError extends Error {
  constructor(
    readonly code:
      | 'missing_issuer_tax_id'
      | 'missing_customer_tax_id'
      | 'no_lines'
      | 'already_voided'
      | 'note_needs_reference'
      | 'reference_not_allowed'
      | 'reference_voided'
      | 'reference_must_be_invoice',
    message: string,
  ) {
    super(message);
    this.name = 'FiscalDocumentError';
  }
}

/** Los tipos que MODIFICAN un comprobante anterior y por lo tanto tienen que decir cuál. */
export const NOTE_TYPES: readonly FiscalDocumentType[] = ['credit_note', 'debit_note'];

export function isNote(t: FiscalDocumentType): boolean {
  return NOTE_TYPES.includes(t);
}

export interface IssuerIdentity {
  tax_id: string | null;
  legal_name?: string | null;
}

/**
 * Qué tiene que estar en su lugar ANTES de tomar un número. El orden importa: si esto se validara
 * después de asignar el correlativo, un comprobante rechazado por falta de RIF habría consumido su
 * número igual — y aunque la transacción lo devuelva, es trabajo y riesgo al pedo.
 *
 * El RIF del EMISOR es obligatorio siempre: es su comprobante. El del RECEPTOR también, salvo en la
 * nota de entrega, que no es un documento de crédito fiscal.
 */
export function assertIssuable(a: {
  type: FiscalDocumentType;
  issuer: IssuerIdentity;
  customer: IssuerIdentity;
  lineCount: number;
}): void {
  if (!a.issuer.tax_id)
    throw new FiscalDocumentError('missing_issuer_tax_id', 'La empresa no tiene RIF cargado: no puede emitir comprobantes');
  if (a.type !== 'delivery_note' && !a.customer.tax_id)
    throw new FiscalDocumentError('missing_customer_tax_id', 'El cliente no tiene RIF cargado: sin él el comprobante no es válido');
  if (!(a.lineCount > 0))
    throw new FiscalDocumentError('no_lines', 'No se puede emitir un comprobante sin líneas');
}

export interface ReferencedDocument {
  document_type: FiscalDocumentType | null;
  standing: FiscalDocumentStanding;
}

/**
 * Una nota de crédito o débito modifica un comprobante anterior. Sin la referencia queda un
 * documento que resta plata sin decir a qué, y el libro de ventas no lo puede casar con nada.
 */
export function assertNoteReference(type: FiscalDocumentType, referenced: ReferencedDocument | null): void {
  if (!isNote(type)) {
    if (referenced) throw new FiscalDocumentError('reference_not_allowed', 'Solo las notas de crédito o débito referencian otro comprobante');
    return;
  }
  if (!referenced) throw new FiscalDocumentError('note_needs_reference', 'La nota tiene que indicar qué comprobante modifica');
  if (referenced.document_type !== 'invoice')
    throw new FiscalDocumentError('reference_must_be_invoice', 'Una nota solo puede modificar una factura, no otra nota');
  // Modificar algo anulado no significa nada: el original ya no tiene efecto que corregir.
  if (referenced.standing === 'voided')
    throw new FiscalDocumentError('reference_voided', 'El comprobante que se quiere modificar está anulado');
}

/**
 * Anular es posible una sola vez. **Anular NO libera el número**: el comprobante sigue existiendo y
 * sigue ocupando su lugar en el correlativo. Devolverlo dejaría un hueco, que es justo lo que hay
 * que poder no tener.
 */
export function assertVoidable(standing: FiscalDocumentStanding): void {
  if (standing === 'voided') throw new FiscalDocumentError('already_voided', 'El comprobante ya está anulado');
}
