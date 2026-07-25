import { BadRequestException } from '@nestjs/common';
import { InvalidRifError, isTaxpayerCondition, parseRif, TAXPAYER_CONDITIONS } from '@cowinance/domain';

/**
 * Identidad fiscal en la frontera de entrada (G4-1): qué regla aplica según el país del tenant.
 *
 * La ARITMÉTICA del RIF vive en `@cowinance/domain`; acá vive solo la decisión de CUÁNDO aplicarla.
 * Es deliberado que sea por país y no global: un tenant argentino carga un CUIT y uno mexicano un
 * RFC, y validarlos con el algoritmo venezolano rechazaría identificaciones perfectamente válidas.
 *
 * Para los países sin regla propia todavía, el identificador se guarda tal cual y `normalized` va
 * NULL. NULL no es «sin identificación»: es «sin regla que lo valide». Como la unicidad se apoya en
 * la columna normalizada, esos países no ganan el guardarraíl de duplicados hasta que se les
 * escriba su regla — mejor eso que una unicidad sobre texto libre, que da la sensación de proteger
 * sin proteger (`J-00123072-6` y `J001230726` pasarían como dos).
 */

/** Países cuyo identificador fiscal el sistema sabe validar hoy. */
const VALIDATORS: Record<string, (raw: string) => string> = {
  // Devuelve el RIF normalizado (`J001230726`); lanza `InvalidRifError` si el dígito no cierra.
  VE: (raw) => {
    const { prefix, body, checkDigit } = parseRif(raw);
    return `${prefix}${body}${checkDigit}`;
  },
};

export interface FiscalIdentity {
  /** Lo que se muestra e imprime. En Venezuela, la forma canónica `J-00123072-6`. */
  tax_id: string | null;
  /** Clave de identidad, sin separadores. NULL si el país no tiene regla o no se cargó nada. */
  tax_id_normalized: string | null;
}

/**
 * Valida y normaliza el identificador fiscal para el país dado. Vacío o ausente devuelve las dos
 * puntas en NULL: el identificador NO es obligatorio para dar de alta un socio —se carga un cliente
 * de contado antes de tener su RIF— y recién lo va a exigir la emisión del comprobante, que es donde
 * de verdad hace falta.
 */
export function resolveFiscalId(countryCode: string, raw: unknown): FiscalIdentity {
  const s = String(raw ?? '').trim();
  if (!s) return { tax_id: null, tax_id_normalized: null };

  const validate = VALIDATORS[String(countryCode ?? '').toUpperCase()];
  if (!validate) return { tax_id: s, tax_id_normalized: null };

  try {
    const normalized = validate(s);
    // Canónica para mostrar: se reconstruye desde lo normalizado, así el mismo RIF se guarda
    // siempre igual sin importar cómo lo haya tipeado quien lo cargó.
    return { tax_id: `${normalized[0]}-${normalized.slice(1, 9)}-${normalized[9]}`, tax_id_normalized: normalized };
  } catch (e) {
    if (e instanceof InvalidRifError)
      throw new BadRequestException({ code: `tax.invalid_rif.${e.problem}`, title: e.message });
    throw e;
  }
}

/** Valida la condición ante el IVA. `undefined` = no se tocó; `null`/vacío = se declara sin dato. */
export function resolveTaxpayerCondition(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!isTaxpayerCondition(raw))
    throw new BadRequestException({
      code: 'tax.invalid_taxpayer_condition',
      title: `Condición de contribuyente inválida (${TAXPAYER_CONDITIONS.join('|')})`,
    });
  return raw;
}
