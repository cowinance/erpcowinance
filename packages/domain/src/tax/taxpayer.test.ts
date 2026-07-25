import { describe, expect, it } from 'vitest';
import {
  TAXPAYER_CONDITIONS,
  TAXPAYER_CONDITION_HINT,
  TAXPAYER_CONDITION_LABEL,
  chargesVat,
  isTaxpayerCondition,
  saleHasVatWithholding,
  withholdsVat,
  type TaxpayerCondition,
} from './taxpayer';

describe('condición del contribuyente', () => {
  it('toda condición tiene etiqueta y explicación', () => {
    // Si falta una, la UI muestra el código crudo y el usuario tiene que saberlo de antes.
    for (const c of TAXPAYER_CONDITIONS) {
      expect(TAXPAYER_CONDITION_LABEL[c]).toBeTruthy();
      expect(TAXPAYER_CONDITION_HINT[c]).toBeTruthy();
    }
  });

  it('reconoce lo válido y descarta lo demás', () => {
    expect(isTaxpayerCondition('ordinario')).toBe(true);
    expect(isTaxpayerCondition('ORDINARIO')).toBe(false);
    expect(isTaxpayerCondition('otra')).toBe(false);
    expect(isTaxpayerCondition(undefined)).toBe(false);
  });
});

describe('quién carga IVA al vender', () => {
  it('el ordinario y el especial sí; el formal y el no contribuyente no', () => {
    expect(chargesVat('ordinario')).toBe(true);
    expect(chargesVat('especial')).toBe(true);
    expect(chargesVat('formal')).toBe(false);
    expect(chargesVat('no_contribuyente')).toBe(false);
  });
});

describe('quién retiene IVA al comprar', () => {
  it('solo el especial', () => {
    expect(withholdsVat('especial')).toBe(true);
    for (const c of ['ordinario', 'formal', 'no_contribuyente'] as TaxpayerCondition[])
      expect(withholdsVat(c)).toBe(false);
  });
});

describe('retención en una venta — hacen falta las DOS puntas', () => {
  it('el caso real del productor: ordinario que le vende a un frigorífico especial', () => {
    // Acá es donde la factura dice un número y el banco muestra otro.
    expect(saleHasVatWithholding('ordinario', 'especial')).toBe(true);
  });

  it('sin cliente especial no hay retención, aunque el emisor cargue IVA', () => {
    expect(saleHasVatWithholding('ordinario', 'ordinario')).toBe(false);
    expect(saleHasVatWithholding('ordinario', 'no_contribuyente')).toBe(false);
  });

  it('no se retiene sobre un IVA que nunca se cargó', () => {
    // Un formal le vende a un especial: no hubo débito fiscal, no hay nada que retener.
    expect(saleHasVatWithholding('formal', 'especial')).toBe(false);
    expect(saleHasVatWithholding('no_contribuyente', 'especial')).toBe(false);
  });

  it('la regla se sostiene para toda combinación', () => {
    for (const emisor of TAXPAYER_CONDITIONS)
      for (const cliente of TAXPAYER_CONDITIONS)
        expect(saleHasVatWithholding(emisor, cliente)).toBe(chargesVat(emisor) && withholdsVat(cliente));
  });
});
