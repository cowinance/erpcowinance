export { computeDressingPct, InvalidCarcassError } from './dressing';
export { computeFeedlotMetrics } from './feedlot';
export type { FeedlotInput, FeedlotMetrics } from './feedlot';
export {
  validateWeighing,
  WEIGHING_MAX_KG,
  WEIGHING_PLAUSIBLE_MIN_KG,
  WEIGHING_PLAUSIBLE_MAX_KG,
  WEIGHING_EXTREME_PCT,
  WEIGHING_EXTREME_ADG,
  WEIGHING_LOSS_WARN_PCT,
} from './weighing';
export type { WeighingValidationInput, WeighingValidationResult, WeighingIssue } from './weighing';
