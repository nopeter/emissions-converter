/**
 * Public surface of the calculation engine.
 *
 * Pure functions only. Nothing here imports React, touches the DOM, or performs
 * I/O, so the engine is testable in a plain Node process.
 */
export {
  calculateFuelCombustion,
  createFuelCombustionModule,
  FUEL_COMBUSTION_INPUTS,
  FUEL_COMBUSTION_MODULE_ID,
} from './combustion';
export { EngineError, type EngineErrorCode } from './errors';
export {
  GASES,
  findCategoryLabel,
  findEmissionFactors,
  findFactorsInCategory,
  findFuel,
  findFuelsCalculableIn,
  findNetCalorificValue,
  findTechnologyDisaggregatedTiers,
  findTiersInCategory,
  findVehicleTechnologiesInCategory,
} from './lookup';
export {
  assertShapeImplemented,
  assertTierSupported,
  IMPLEMENTED_INPUT_SHAPES,
  matrix,
  optionalInputsAt,
  readOptionalScalar,
  readOptionalSelection,
  readScalar,
  readSelection,
  requiredInputsAt,
  scalar,
  selection,
  timeSeries,
  validateInputs,
  type CalculateOptions,
  type CalculationModule,
  type InputDeclaration,
  type InputOption,
  type InputSchema,
  type InputShape,
  type InputValue,
  type MatrixValue,
  type ModuleInputs,
  type ScalarValue,
  type SelectionValue,
  type TierSupport,
  type TimeSeriesPoint,
  type TimeSeriesValue,
} from './module';
export {
  CATEGORY_DEFINITIONS,
  categoryRegistry,
  createCategoryRegistry,
  PATH_SEPARATOR,
  SECTOR_VOLUMES,
  type CategoryDefinition,
  type CategoryNode,
  type CategoryRegistry,
  type Sector,
} from './registry';
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
