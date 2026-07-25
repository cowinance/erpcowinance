export {
  RIF_PREFIXES,
  RIF_PREFIX_LABEL,
  InvalidRifError,
  completeRif,
  isValidRif,
  normalizeRif,
  parseRif,
  rifCheckDigit,
} from './rif';
export type { ParsedRif, RifPrefix, RifProblem } from './rif';

export {
  TAXPAYER_CONDITIONS,
  TAXPAYER_CONDITION_HINT,
  TAXPAYER_CONDITION_LABEL,
  chargesVat,
  isTaxpayerCondition,
  saleHasVatWithholding,
  withholdsVat,
} from './taxpayer';
export type { TaxpayerCondition } from './taxpayer';
