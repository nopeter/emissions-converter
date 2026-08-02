/**
 * Errors the engine raises when it cannot proceed at all.
 *
 * A missing factor for one gas is a gap, not an error: the rest of the
 * calculation still stands and the gap is returned for display. An error is
 * reserved for cases where there is nothing to return — an unknown fuel, an
 * unknown category, a nonsensical mass, or a fuel with no calorific value.
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
  | 'unknown_fuel'
  | 'unknown_category'
  | 'invalid_mass'
  | 'missing_calorific_value'
  | 'unexpected_unit';
