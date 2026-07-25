import { describe, expect, it } from 'vitest';
import {
  InvalidVatRateError,
  TAXABLE_TREATMENTS,
  VAT_TREATMENTS,
  VAT_TREATMENT_LABEL,
  computeVatBreakdown,
  isVatTreatment,
  validateVatRates,
  type VatRates,
} from './vat';

/** Alícuotas de ejemplo. En producción vienen de la configuración de la organización. */
const RATES: VatRates = { general: 0.16, reduced: 0.08, additional: 0.15 };

const grupo = (b: ReturnType<typeof computeVatBreakdown>, t: string) => b.groups.find((g) => g.treatment === t);

describe('desglose por alícuota', () => {
  it('separa base e IVA de cada alícuota presente', () => {
    const b = computeVatBreakdown(
      [
        { line_total: 1000, treatment: 'general' },
        { line_total: 500, treatment: 'reduced' },
      ],
      RATES,
    );
    expect(grupo(b, 'general')).toMatchObject({ base: 1000, rate: 0.16, tax: 160 });
    expect(grupo(b, 'reduced')).toMatchObject({ base: 500, rate: 0.08, tax: 40 });
    expect(b.vat_total).toBe(200);
    expect(b.total).toBe(1700);
  });

  it('no inventa filas de alícuotas que el documento no usa', () => {
    // Un comprobante con «Alícuota adicional: 0,00» es ruido que hay que leer igual.
    const b = computeVatBreakdown([{ line_total: 100, treatment: 'general' }], RATES);
    expect(b.groups).toHaveLength(1);
  });

  it('agrupa varias líneas de la misma alícuota en una sola fila', () => {
    const b = computeVatBreakdown(
      [
        { line_total: 100, treatment: 'general' },
        { line_total: 200, treatment: 'general' },
        { line_total: 300, treatment: 'general' },
      ],
      RATES,
    );
    expect(b.groups).toHaveLength(1);
    expect(grupo(b, 'general')!.base).toBe(600);
    expect(grupo(b, 'general')!.tax).toBe(96);
  });

  it('el orden es el del comprobante, no el de carga de las líneas', () => {
    const b = computeVatBreakdown(
      [
        { line_total: 100, treatment: 'not_subject' },
        { line_total: 100, treatment: 'general' },
        { line_total: 100, treatment: 'exempt' },
      ],
      RATES,
    );
    expect(b.groups.map((g) => g.treatment)).toEqual(['general', 'exempt', 'not_subject']);
  });
});

describe('exento y no sujeto no son lo mismo', () => {
  it('suman base, no generan impuesto, y se informan por separado', () => {
    // Con `tax_rate = 0` los dos serían indistinguibles, y el libro de ventas los necesita en
    // columnas distintas.
    const b = computeVatBreakdown(
      [
        { line_total: 1000, treatment: 'general' },
        { line_total: 400, treatment: 'exempt' },
        { line_total: 250, treatment: 'not_subject' },
      ],
      RATES,
    );
    expect(b.taxable_base).toBe(1000);
    expect(b.exempt_base).toBe(400);
    expect(b.not_subject_base).toBe(250);
    expect(grupo(b, 'exempt')!.tax).toBe(0);
    expect(grupo(b, 'not_subject')!.tax).toBe(0);
    expect(b.vat_total).toBe(160);
    expect(b.subtotal).toBe(1650); // la base total incluye lo exento y lo no sujeto
    expect(b.total).toBe(1810);
  });

  it('una alícuota configurada para exento se ignora: no es negociable', () => {
    const b = computeVatBreakdown([{ line_total: 1000, treatment: 'exempt' }], { ...RATES, exempt: 0.16 } as VatRates);
    expect(grupo(b, 'exempt')).toMatchObject({ rate: 0, tax: 0 });
  });
});

describe('el redondeo va POR GRUPO, no por línea', () => {
  it('el IVA impreso es exactamente su base por la tasa', () => {
    // Es lo que hace que el comprobante cierre contra sí mismo: base × alícuota = IVA mostrado.
    const lineas = Array.from({ length: 3 }, () => ({ line_total: 0.1, treatment: 'general' as const }));
    const b = computeVatBreakdown(lineas, RATES);
    const g = grupo(b, 'general')!;
    expect(g.base).toBe(0.3);
    expect(g.tax).toBe(Math.round(0.3 * 0.16 * 100) / 100); // 0.05
    expect(g.tax).toBe(0.05);
  });

  it('cuando sumar por línea daría otro número, la diferencia se EXPONE', () => {
    // Línea por línea: round2(0.1×0.16)=0.02 tres veces = 0.06. Por grupo: round2(0.3×0.16)=0.05.
    // Dos formas de sumar el mismo documento que dan distinto es el descuadre que nadie sabe
    // explicar después. Se muestra en vez de esconderse.
    const lineas = Array.from({ length: 3 }, () => ({ line_total: 0.1, treatment: 'general' as const }));
    const b = computeVatBreakdown(lineas, RATES);
    expect(b.vat_total).toBe(0.05);
    expect(b.rounding_delta).toBe(-0.01);
  });

  it('en el caso normal no hay diferencia que reportar', () => {
    const b = computeVatBreakdown(
      [
        { line_total: 1000, treatment: 'general' },
        { line_total: 500, treatment: 'general' },
      ],
      RATES,
    );
    expect(b.rounding_delta).toBe(0);
  });
});

describe('casos borde', () => {
  it('un documento sin líneas da todo en cero, no NaN', () => {
    const b = computeVatBreakdown([], RATES);
    expect(b).toMatchObject({ groups: [], subtotal: 0, vat_total: 0, total: 0, rounding_delta: 0 });
  });

  it('descarta importes que no son números en vez de propagar NaN', () => {
    // Un NaN suelto envenena el total entero y el comprobante sale con «NaN».
    const b = computeVatBreakdown(
      [
        { line_total: Number.NaN, treatment: 'general' },
        { line_total: 100, treatment: 'general' },
      ],
      RATES,
    );
    expect(b.vat_total).toBe(16);
    expect(b.total).toBe(116);
  });

  it('una alícuota sin configurar se trata como cero, no revienta', () => {
    const b = computeVatBreakdown([{ line_total: 100, treatment: 'additional' }], { general: 0.16 });
    expect(grupo(b, 'additional')).toMatchObject({ rate: 0, tax: 0 });
  });

  it('importes negativos (devoluciones) se desglosan igual', () => {
    const b = computeVatBreakdown([{ line_total: -1000, treatment: 'general' }], RATES);
    expect(grupo(b, 'general')!.tax).toBe(-160);
    expect(b.total).toBe(-1160);
  });
});

describe('validación de alícuotas configuradas', () => {
  it('acepta fracciones', () => {
    expect(() => validateVatRates({ general: 0.16, reduced: 0.08, additional: 0.15 })).not.toThrow();
    expect(() => validateVatRates({})).not.toThrow();
    expect(() => validateVatRates({ general: 0 })).not.toThrow();
  });

  it('atrapa el porcentaje cargado como entero', () => {
    // `16` en vez de `0.16` no falla: factura 1600% de IVA, y se descubre en el comprobante emitido.
    expect(() => validateVatRates({ general: 16 })).toThrow(InvalidVatRateError);
  });

  it('rechaza negativos y basura', () => {
    expect(() => validateVatRates({ general: -0.1 })).toThrow(InvalidVatRateError);
    expect(() => validateVatRates({ general: Number.NaN })).toThrow(InvalidVatRateError);
  });
});

describe('catálogo de tratamientos', () => {
  it('todos tienen etiqueta', () => {
    for (const t of VAT_TREATMENTS) expect(VAT_TREATMENT_LABEL[t]).toBeTruthy();
  });

  it('exento y no sujeto NO generan débito fiscal', () => {
    expect(TAXABLE_TREATMENTS).toEqual(['general', 'reduced', 'additional']);
    expect(TAXABLE_TREATMENTS).not.toContain('exempt');
    expect(TAXABLE_TREATMENTS).not.toContain('not_subject');
  });

  it('reconoce lo válido y descarta lo demás', () => {
    expect(isVatTreatment('general')).toBe(true);
    expect(isVatTreatment('GENERAL')).toBe(false);
    expect(isVatTreatment(undefined)).toBe(false);
  });
});
