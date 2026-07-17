/**
 * Documentos formales del DMS (A6). Un documento envuelve un archivo (file_id) y agrega metadatos:
 * tipo, emisor, vigencia y vencimiento, con enlace polimórfico opcional a cualquier entidad. Acá se
 * valida y normaliza la entrada; la derivación de vencido/por-vencer la hace el servicio con CURRENT_DATE.
 */
export const DOCUMENT_TYPES = ['certificate', 'contract', 'invoice', 'health_guide', 'report', 'permit', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export class InvalidDocumentError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidDocumentError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!ISO_DATE.test(s)) throw new InvalidDocumentError(`${label} inválida (se espera AAAA-MM-DD)`);
  return s;
}

export interface DocumentInput {
  type: DocumentType;
  title: string;
  issuedBy: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  entityType: string | null;
  entityId: string | null;
}

export function validateDocumentInput(input: {
  type?: unknown;
  title?: unknown;
  issued_by?: unknown;
  issue_date?: unknown;
  expiry_date?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
}): DocumentInput {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(String(input.type))) {
    throw new InvalidDocumentError(`Tipo de documento inválido: ${String(input.type)}`);
  }
  const title = String(input.title ?? '').trim();
  if (!title) throw new InvalidDocumentError('El título es obligatorio');

  const issueDate = optionalDate(input.issue_date, 'Fecha de emisión');
  const expiryDate = optionalDate(input.expiry_date, 'Fecha de vencimiento');
  if (issueDate && expiryDate && expiryDate < issueDate) {
    throw new InvalidDocumentError('El vencimiento no puede ser anterior a la emisión');
  }
  const entityType = input.entity_type == null || String(input.entity_type).trim() === '' ? null : String(input.entity_type).trim();
  const entityId = input.entity_id == null || String(input.entity_id).trim() === '' ? null : String(input.entity_id).trim();
  // El enlace polimórfico es todo-o-nada: tipo e id juntos.
  if ((entityType == null) !== (entityId == null)) {
    throw new InvalidDocumentError('El enlace a una entidad requiere tipo e id juntos');
  }

  return {
    type: input.type as DocumentType,
    title,
    issuedBy: input.issued_by == null || String(input.issued_by).trim() === '' ? null : String(input.issued_by).trim(),
    issueDate,
    expiryDate,
    entityType,
    entityId,
  };
}
