export {
  OPPORTUNITY_STAGES,
  STAGE_PROBABILITY,
  TERMINAL_STAGES,
  InvalidStageTransitionError,
  assertStageTransition,
  isTerminal,
  summarizePipeline,
} from './pipeline';
export type { OpportunityLike, OpportunityStage, PipelineSummary } from './pipeline';

export {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  DEFAULT_EXPIRY_WINDOW_DAYS,
  contractStanding,
  isCurrent,
  summarizeContracts,
} from './contracts';
export type { ContractLike, ContractStanding, ContractStatus, ContractType, ContractsSummary } from './contracts';
