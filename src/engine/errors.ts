/**
 * Errors the engine raises when it cannot proceed.
 *
 * The engine never returns a partial result. If any parameter a calculation
 * needs is missing, null or ambiguous, it throws, naming both the parameter and
 * the input combination that asked for it. A half-populated result would look
 * like an answer, and a wrong emission number is worse than no number.
 *
 * Every message is written to be readable by a non-specialist, because these
 * strings will end up in front of a user when a calculation cannot be done.
 */
export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

export type EngineErrorCode =
  /** No fuel with the given id exists in the parameter library. */
  | 'unknown_fuel'
  /** No category with the given code exists in the parameter library. */
  | 'unknown_category'
  /** The mass was not a finite, non-negative number of kilograms. */
  | 'invalid_mass'
  /** The fuel exists but the library publishes no net calorific value for it. */
  | 'missing_calorific_value'
  /** No emission factor is published for this fuel, category and gas. */
  | 'missing_emission_factor'
  /** Several factors match and choosing between them is the caller's decision. */
  | 'ambiguous_emission_factor'
  /** The parameter record exists but its value is null or not a finite number. */
  | 'null_parameter_value'
  /** The parameter is published in a unit the engine does not know how to apply. */
  | 'unexpected_unit';
