/**
 * IVA venezolano (G4-3) — desglose por alícuota. Regla única del comprobante y del libro de ventas.
 *
 * Todo en USD: por decisión del productor no hay bolívares, ni tasa de cambio, ni reexpresión. Este
 * módulo no conoce más de una moneda a propósito.
 *
 * Por qué no alcanza con `computeDocumentTotals` (que ya existe y da subtotal/impuesto/total): el
 * comprobante venezolano tiene que mostrar la **base imponible y el IVA SEPARADOS POR ALÍCUOTA**, y
 * además distinguir lo **exento** de lo **no sujeto**. Un único `tax_total` pierde las dos cosas —
 * y con `tax_rate = 0` para ambos, exento y no sujeto quedan indistinguibles, que es justo la
 * información que el libro de ventas necesita en columnas distintas.
 *
 * Las ALÍCUOTAS no viven acá: entran como parámetro porque son configuración de la organización.
 * En Venezuela cambian por providencia; en el código, cada cambio sería un deploy.
 */

/** Tratamiento de una línea frente al IVA. */
export const VAT_TREATMENTS = ['general', 'reduced', 'additional', 'exempt', 'not_subject'] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

export const VAT_TREATMENT_LABEL: Record<VatTreatment, string> = {
  general: 'Alícuota general',
  reduced: 'Alícuota reducida',
  additional: 'Alícuota adicional',
  exempt: 'Exento',
  not_subject: 'No sujeto',
};

/** Los que generan débito fiscal. Exento y no sujeto suman base pero no impuesto. */
export const TAXABLE_TREATMENTS: readonly VatTreatment[] = ['general', 'reduced', 'additional'];

export function isVatTreatment(v: unknown): v is VatTreatment {
  return typeof v === 'string' && (VAT_TREATMENTS as readonly string[]).includes(v);
}

/** Alícuotas vigentes, como FRACCIÓN (0.16 = 16%), igual que `computeDocumentTotals`. */
export type VatRates = Partial<Record<VatTreatment, number>>;

export interface VatLineInput {
  /**
   * Total de la línea YA CALCULADO (cantidad × precio, redondeado). Se recibe hecho a propósito:
   * recalcularlo acá sería una segunda regla para el mismo número, y el día que difiriera de
   * `computeDocumentTotals` el comprobante y la venta mostrarían importes distintos.
   */
  line_total: number;
  treatment: VatTreatment;
}

export interface VatGroup {
  treatment: VatTreatment;
  /** Fracción aplicada (0 en exento y no sujeto). */
  rate: number;
  base: number;
  tax: number;
}

export interface VatBreakdown {
  /** Un grupo por alícuota PRESENTE en el documento; sin filas vacías que ensucien el comprobante. */
  groups: VatGroup[];
  taxable_base: number;
  exempt_base: number;
  not_subject_base: number;
  /** Suma de todas las bases: es el subtotal del comprobante. */
  subtotal: number;
  vat_total: number;
  total: number;
  /**
   * Diferencia contra sumar el IVA línea por línea. Casi siempre 0; cuando no, son centavos de
   * redondeo. Se EXPONE en vez de esconderse: dos formas de sumar el mismo documento que dan
   * distinto es exactamente el tipo de descuadre que después nadie sabe explicar.
   */
  rounding_delta: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Desglosa el IVA por alícuota.
 *
 * **El impuesto se redondea POR GRUPO, no por línea**, y no es un detalle de implementación: el
 * comprobante imprime «base imponible» e «IVA» de cada alícuota, y el segundo tiene que ser
 * exactamente el primero por la tasa. Redondeando línea por línea y sumando, el IVA impreso puede no
 * coincidir con su propia base — un comprobante que no cierra contra sí mismo.
 */
export function computeVatBreakdown(lines: VatLineInput[], rates: VatRates): VatBreakdown {
  const bases = new Map<VatTreatment, number>();
  for (const l of lines) {
    const amount = Number(l.line_total);
    if (!Number.isFinite(amount)) continue;
    bases.set(l.treatment, round2((bases.get(l.treatment) ?? 0) + amount));
  }

  // Orden estable y previsible: siempre el mismo del comprobante, no el de carga de las líneas.
  const groups: VatGroup[] = VAT_TREATMENTS.filter((t) => bases.has(t)).map((treatment) => {
    const base = bases.get(treatment)!;
    const rate = TAXABLE_TREATMENTS.includes(treatment) ? Number(rates[treatment] ?? 0) : 0;
    return { treatment, rate, base, tax: round2(base * rate) };
  });

  const sumBy = (pred: (t: VatTreatment) => boolean) => round2(groups.filter((g) => pred(g.treatment)).reduce((s, g) => s + g.base, 0));

  const taxableBase = sumBy((t) => TAXABLE_TREATMENTS.includes(t));
  const exemptBase = sumBy((t) => t === 'exempt');
  const notSubjectBase = sumBy((t) => t === 'not_subject');
  const subtotal = round2(taxableBase + exemptBase + notSubjectBase);
  const vatTotal = round2(groups.reduce((s, g) => s + g.tax, 0));

  // El mismo IVA sumado línea por línea, solo para poder mostrar la diferencia.
  const porLinea = round2(
    lines.reduce((s, l) => {
      const rate = TAXABLE_TREATMENTS.includes(l.treatment) ? Number(rates[l.treatment] ?? 0) : 0;
      return s + round2(Number(l.line_total) * rate);
    }, 0),
  );

  return {
    groups,
    taxable_base: taxableBase,
    exempt_base: exemptBase,
    not_subject_base: notSubjectBase,
    subtotal,
    vat_total: vatTotal,
    total: round2(subtotal + vatTotal),
    rounding_delta: round2(vatTotal - porLinea),
  };
}

export class InvalidVatRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVatRateError';
  }
}

/**
 * Valida las alícuotas configuradas. Se hace al guardar la configuración y no al facturar: una
 * alícuota escrita como `16` en vez de `0.16` no falla, factura 1600% de IVA — y eso se descubre en
 * el comprobante que ya salió.
 */
export function validateVatRates(rates: VatRates): void {
  for (const t of TAXABLE_TREATMENTS) {
    const r = rates[t];
    if (r === undefined || r === null) continue;
    const n = Number(r);
    if (!Number.isFinite(n) || n < 0)
      throw new InvalidVatRateError(`La alícuota ${VAT_TREATMENT_LABEL[t]} tiene que ser un número positivo`);
    // Se expresan como fracción (0.16 = 16%). Uno mayor que 1 es casi seguro un porcentaje mal
    // cargado, y el error es caro: se ve recién en el comprobante emitido.
    if (n > 1)
      throw new InvalidVatRateError(
        `La alícuota ${VAT_TREATMENT_LABEL[t]} se expresa como fracción: 0.16 para 16%, no 16`,
      );
  }
}
