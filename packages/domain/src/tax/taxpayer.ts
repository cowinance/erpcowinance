/**
 * Condición del contribuyente ante el IVA (Venezuela, G4-1). Es el segundo dato de identidad fiscal
 * después del RIF, y NO es decorativo: decide si una operación lleva IVA y quién retiene a quién.
 *
 * Va tanto en la empresa que emite como en cada socio de negocio, porque las dos puntas mandan:
 * - Lo que YO soy decide si cobro IVA en mis ventas.
 * - Lo que es MI CLIENTE decide si me retiene parte de ese IVA al pagarme.
 *
 * Ese segundo caso es el que sorprende: el productor es contribuyente ORDINARIO y no retiene a
 * nadie, pero si le vende a un frigorífico designado contribuyente ESPECIAL, el frigorífico le
 * retiene el 75% o el 100% del IVA facturado y le paga la diferencia. La factura dice un número y
 * el banco muestra otro. Sin la condición de la contraparte guardada, esa diferencia aparece como
 * un faltante de cobranza que nadie sabe explicar.
 *
 * Puro, sin IO. Las ALÍCUOTAS y los PORCENTAJES de retención NO viven acá: son configuración
 * (cambian por providencia). Acá vive quién está sujeto a qué, que es lo estructural.
 */

export const TAXPAYER_CONDITIONS = ['ordinario', 'especial', 'formal', 'no_contribuyente'] as const;
export type TaxpayerCondition = (typeof TAXPAYER_CONDITIONS)[number];

export const TAXPAYER_CONDITION_LABEL: Record<TaxpayerCondition, string> = {
  ordinario: 'Contribuyente ordinario',
  especial: 'Contribuyente especial',
  formal: 'Contribuyente formal',
  no_contribuyente: 'No contribuyente',
};

/** Qué significa cada una, en la UI, para que no haya que saberlo de antes. */
export const TAXPAYER_CONDITION_HINT: Record<TaxpayerCondition, string> = {
  ordinario: 'Cobra IVA en sus ventas y lo descuenta en sus compras',
  especial: 'Designado por el SENIAT: además retiene el IVA a sus proveedores',
  formal: 'Solo realiza actividades exentas o no sujetas: emite comprobante sin IVA',
  no_contribuyente: 'Consumidor final u otro sujeto que no maneja crédito fiscal',
};

export function isTaxpayerCondition(v: unknown): v is TaxpayerCondition {
  return typeof v === 'string' && (TAXPAYER_CONDITIONS as readonly string[]).includes(v);
}

/**
 * ¿Este contribuyente carga IVA cuando VENDE? El formal y el no contribuyente no generan débito
 * fiscal: emiten el comprobante sin impuesto.
 */
export function chargesVat(condition: TaxpayerCondition): boolean {
  return condition === 'ordinario' || condition === 'especial';
}

/**
 * ¿Este contribuyente RETIENE el IVA cuando COMPRA? Solo el especial. Aplicado al socio de negocio
 * responde la pregunta que importa al cobrar: «¿este cliente me va a retener?».
 */
export function withholdsVat(condition: TaxpayerCondition): boolean {
  return condition === 'especial';
}

/**
 * ¿Hay retención de IVA en esta operación de venta? Necesita las DOS puntas: solo hay retención si
 * el que emite realmente cargó IVA y el que paga está designado para retener. Regla única — que la
 * usen por igual la facturación, la cobranza y el reporte, o cada una calculará su propia verdad.
 */
export function saleHasVatWithholding(issuer: TaxpayerCondition, customer: TaxpayerCondition): boolean {
  return chargesVat(issuer) && withholdsVat(customer);
}
