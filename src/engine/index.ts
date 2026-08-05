/**
 * Public surface of the calculation engine.
 *
 * Pure functions only. Nothing here imports React, touches the DOM, or performs
 * I/O, so the engine is testable in a plain Node process.
 */
export { toCarbonDioxideEquivalent } from './co2e';
export { calculateFuelCombustion } from './combustion';
export { EngineError, type EngineErrorCode } from './errors';
export {
  GASES,
  findCategoryLabel,
  findEmissionFactors,
  findFuel,
  findGwpSet,
  findGwpValues,
  findNetCalorificValue,
} from './lookup';
export {
  combineAdditive,
  combineMultiplicative,
  evaluateCandidate,
  intervalToPercent,
  isAsymmetric,
  type AdditiveCandidate,
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
