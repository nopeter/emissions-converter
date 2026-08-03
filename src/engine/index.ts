/**
 * Public surface of the calculation engine.
 *
 * Pure functions only. Nothing here imports React, touches the DOM, or performs
 * I/O, so the engine is testable in a plain Node process.
 */
export { calculateFuelCombustion } from './combustion';
export { EngineError, type EngineErrorCode } from './errors';
export {
  GASES,
  findCategoryLabel,
  findEmissionFactors,
  findFuel,
  findNetCalorificValue,
} from './lookup';
export {
  combineMultiplicative,
  evaluateCandidate,
  intervalToPercent,
  isAsymmetric,
  type UncertaintyCandidate,
} from './uncertainty';
export {
  EXPECTED_EMISSION_FACTOR_UNIT,
  EXPECTED_NCV_UNIT,
  GIGAGRAMS_PER_KILOGRAM,
  kilogramsToGigagrams,
  massToTerajoules,
} from './units';
export type * from './types';
