import { describe, expect, it } from 'vitest';
import { InvalidDocumentError, validateDocumentInput } from './document';

describe('validateDocumentInput', () => {
  it('normaliza un documento válido con enlace a entidad', () => {
    const d = validateDocumentInput({
      type: 'certificate',
      title: '  Certificado de brucelosis  ',
      issued_by: ' SENASA ',
      issue_date: '2030-01-10',
      expiry_date: '2031-01-10',
      entity_type: 'animal',
      entity_id: 'a1',
    });
    expect(d).toEqual({ type: 'certificate', title: 'Certificado de brucelosis', issuedBy: 'SENASA', issueDate: '2030-01-10', expiryDate: '2031-01-10', entityType: 'animal', entityId: 'a1' });
  });

  it('tipo inválido y título vacío → error', () => {
    expect(() => validateDocumentInput({ type: 'foo', title: 'X' })).toThrow(InvalidDocumentError);
    expect(() => validateDocumentInput({ type: 'report', title: '  ' })).toThrow(InvalidDocumentError);
  });

  it('vencimiento anterior a emisión → error', () => {
    expect(() => validateDocumentInput({ type: 'permit', title: 'P', issue_date: '2030-05-01', expiry_date: '2030-04-01' })).toThrow(InvalidDocumentError);
  });

  it('fecha con formato inválido → error', () => {
    expect(() => validateDocumentInput({ type: 'permit', title: 'P', expiry_date: '01/01/2030' })).toThrow(InvalidDocumentError);
  });

  it('enlace a entidad debe ser tipo+id juntos', () => {
    expect(() => validateDocumentInput({ type: 'other', title: 'X', entity_type: 'animal' })).toThrow(InvalidDocumentError);
    expect(validateDocumentInput({ type: 'other', title: 'X' }).entityType).toBeNull();
  });

  it('fechas opcionales → null', () => {
    const d = validateDocumentInput({ type: 'invoice', title: 'Factura' });
    expect(d.issueDate).toBeNull();
    expect(d.expiryDate).toBeNull();
    expect(d.issuedBy).toBeNull();
  });
});
