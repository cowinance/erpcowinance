export { isUuid, InvalidIdentifier, makeIdentifier } from './identifier';
export type { IdentifierFactory } from './identifier';
// Patrón companion: cada nombre reexporta a la vez el tipo y su factory.
export { TenantId, FarmId, AnimalId, LotId } from './ids';
export { TagNumber, InvalidTagNumber } from './tag-number';
export { Weight, InvalidWeight, WEIGHT_SCALE } from './weight';
export { Sex, InvalidSex } from './sex';
