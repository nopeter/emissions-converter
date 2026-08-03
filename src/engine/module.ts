/**
 * The interface every calculation module implements.
 *
 * The 2006 Guidelines are a tree of source categories, each with its own method,
 * its own inputs and its own tiers. Fuel combustion needs a mass; Waste First
 * Order Decay needs decades of historical waste tonnage; AFOLU needs a land-use
 * transition matrix. Nothing useful is shared between those calculations except
 * the shape of the conversation: *what do you need, what tiers can you do it at,
 * and what did you produce and why*. That conversation is what this file defines.
 *
 * A module is bound to exactly one category code. Two categories that share an
 * implementation (1A4b and 1A3b both burn fuel) are two module instances built
 * from the same factory, not one module answering for both, so that
 * `declareInputs()` and `availableTiers()` can answer precisely: the fuels
 * offered in a kitchen are not the fuels offered in a car.
 *
 * Nothing here computes. This file declares types, validates the inputs a module
 * was handed against the schema it published, and refuses — loudly — to proceed
 * on an input shape that has no implementation yet.
 */
import type { CategoryCode, ParameterLibrary, Tier } from '../data/types';
import { EngineError } from './errors';
import type { CalculationResult } from './types';

/**
 * The shapes of input an IPCC method can require.
 *
 * `scalar` and `selection` are implemented. The other two exist because the
 * methods that need them are in scope and not yet built, and a type system that
 * cannot express them would quietly push those methods towards being modelled as
 * a bag of scalars:
 *
 *   - `timeSeries` — Waste, Vol 5 Ch 3: First Order Decay integrates a
 *     year-indexed history of deposited waste. A single number cannot stand in
 *     for it.
 *   - `matrix` — AFOLU, Vol 4 Ch 3: the land representation is a two-dimensional
 *     matrix of area converted from each land-use category to each other one.
 *
 * Declaring an input of an unimplemented shape is allowed. Calculating with one
 * is not: `assertShapeImplemented` throws rather than ignoring the value.
 */
export type InputShape = 'scalar' | 'selection' | 'timeSeries' | 'matrix';

/** The shapes a module may actually calculate with today. */
export const IMPLEMENTED_INPUT_SHAPES: readonly InputShape[] = ['scalar', 'selection'];

/** One allowed value of a `selection` input, with the library's own label. */
export interface InputOption {
  value: string;
  label: string;
}

/**
 * One input a module can be given.
 *
 * `availableAtTiers` and `requiredAtTiers` are separate on purpose.  A vehicle
 * technology is required at Tier 3 and *not accepted* at Tier 1: accepting it
 * there would apply technology-disaggregated factors to a result labelled as an
 * IPCC default, which is the exact mislabelling CLAUDE.md rule 6 forbids.
 */
export interface InputDeclaration {
  name: string;
  label: string;
  shape: InputShape;
  /** Unit of the value, or null where the input has none (a selection). */
  unit: string | null;
  /** Plain-English description, suitable for a form hint. */
  description: string;
  /** Tiers at which this input may be supplied. */
  availableAtTiers: readonly Tier[];
  /** Tiers at which this input must be supplied. A subset of the above. */
  requiredAtTiers: readonly Tier[];
  /** Allowed values for a `selection`, read from the parameter library. */
  options?: readonly InputOption[];
}

/** Everything a module needs, as published by the module itself. */
export interface InputSchema {
  categoryCode: CategoryCode;
  inputs: readonly InputDeclaration[];
}

/** A tier this module supports, and what using it costs the caller. */
export interface TierSupport {
  tier: Tier;
  /** What data specificity this tier demands, in plain English. */
  requires: string;
  /** Names of declared inputs that become required at this tier. */
  requiredInputs: readonly string[];
}

/** A single number, e.g. a mass in kilograms. */
export interface ScalarValue {
  shape: 'scalar';
  value: number;
}

/** A named choice from a list the parameter library publishes. */
export interface SelectionValue {
  shape: 'selection';
  value: string;
}

/** One year of a time series. */
export interface TimeSeriesPoint {
  year: number;
  value: number;
}

/** A year-indexed history. Declarable now, not calculable yet. */
export interface TimeSeriesValue {
  shape: 'timeSeries';
  points: readonly TimeSeriesPoint[];
}

/**
 * A two-dimensional matrix, e.g. area converted from each land use to each
 * other one. Declarable now, not calculable yet.
 */
export interface MatrixValue {
  shape: 'matrix';
  rows: readonly string[];
  columns: readonly string[];
  /** `values[row][column]`, indexed by the arrays above. */
  values: readonly (readonly number[])[];
}

export type InputValue = ScalarValue | SelectionValue | TimeSeriesValue | MatrixValue;

/** Inputs handed to a module, keyed by the names it declared. */
export type ModuleInputs = Readonly<Record<string, InputValue>>;

export const scalar = (value: number): ScalarValue => ({ shape: 'scalar', value });

export const selection = (value: string): SelectionValue => ({ shape: 'selection', value });

export const timeSeries = (points: readonly TimeSeriesPoint[]): TimeSeriesValue => ({
  shape: 'timeSeries',
  points,
});

export const matrix = (
  rows: readonly string[],
  columns: readonly string[],
  values: readonly (readonly number[])[],
): MatrixValue => ({ shape: 'matrix', rows, columns, values });

/** Options that select between parameters or sources, rather than supplying them. */
export interface CalculateOptions {
  /** Read parameters from an alternative library. Defaults to the shipped one. */
  library?: ParameterLibrary;
}

/**
 * What a category's calculation method must be able to answer.
 *
 * Implementations are pure: no React, no DOM, no I/O. They read the parameter
 * library and return a result with its audit trail, or they throw.
 */
export interface CalculationModule<TResult extends CalculationResult = CalculationResult> {
  /** Stable identifier for the method, e.g. "fuel_combustion". */
  readonly id: string;
  /** Human-readable name of the method. */
  readonly label: string;
  /** The one category this instance calculates. */
  readonly categoryCode: CategoryCode;
  /** What this module needs, and at which tiers. */
  declareInputs(): InputSchema;
  /** Which tiers it supports here, and what each requires. */
  availableTiers(): readonly TierSupport[];
  /** The calculation, with its audit trail. Throws rather than returning a hole. */
  calculate(inputs: ModuleInputs, tier: Tier, options?: CalculateOptions): TResult;
}

/** The inputs that must be supplied at a given tier. */
export function requiredInputsAt(schema: InputSchema, tier: Tier): InputDeclaration[] {
  return schema.inputs.filter((input) => input.requiredAtTiers.includes(tier));
}

/** The inputs that may be supplied at a given tier but need not be. */
export function optionalInputsAt(schema: InputSchema, tier: Tier): InputDeclaration[] {
  return schema.inputs.filter(
    (input) => input.availableAtTiers.includes(tier) && !input.requiredAtTiers.includes(tier),
  );
}

/**
 * Refuse to calculate with an input shape that has no implementation.
 *
 * The alternative — accepting the value and ignoring it — would return a number
 * that looks like an answer to a question nobody actually answered.
 */
export function assertShapeImplemented(shape: InputShape, context: string): void {
  if (IMPLEMENTED_INPUT_SHAPES.includes(shape)) {
    return;
  }
  throw new EngineError(
    'unimplemented_input_shape',
    `${context} is a "${shape}" input, and calculating with that shape is not yet implemented. ` +
      `Implemented shapes: ${IMPLEMENTED_INPUT_SHAPES.join(', ')}. The value was rejected rather ` +
      `than ignored, because ignoring it would produce a result that did not use it.`,
  );
}

/**
 * Check supplied inputs against the schema the module published.
 *
 * Every failure is a refusal, not a correction: an unknown name is not dropped,
 * a missing required input is not defaulted, and a value of the wrong shape is
 * not coerced.
 */
export function validateInputs(schema: InputSchema, inputs: ModuleInputs, tier: Tier): void {
  const declared = new Map(schema.inputs.map((input) => [input.name, input]));

  for (const name of Object.keys(inputs)) {
    const declaration = declared.get(name);
    if (!declaration) {
      throw new EngineError(
        'unknown_input',
        `"${name}" is not an input of category ${schema.categoryCode}. Declared inputs: ` +
          `${schema.inputs.map((input) => input.name).join(', ')}.`,
      );
    }

    if (!declaration.availableAtTiers.includes(tier)) {
      throw new EngineError(
        'input_not_available_at_tier',
        `"${name}" is not an input of category ${schema.categoryCode} at Tier ${tier}; it applies ` +
          `at Tier ${declaration.availableAtTiers.join(', Tier ')}. Accepting it here would use ` +
          `parameters from one tier in a result labelled as another.`,
      );
    }

    const supplied = inputs[name];
    if (supplied.shape !== declaration.shape) {
      throw new EngineError(
        'wrong_input_shape',
        `"${name}" was declared as a "${declaration.shape}" input but a "${supplied.shape}" value ` +
          `was supplied.`,
      );
    }

    assertShapeImplemented(declaration.shape, `Input "${name}" of category ${schema.categoryCode}`);
  }

  for (const declaration of requiredInputsAt(schema, tier)) {
    // Checked before the presence test so that a category whose method needs a
    // shape the engine cannot yet handle says so, rather than complaining that
    // an input it could not have used anyway is missing.
    assertShapeImplemented(
      declaration.shape,
      `Input "${declaration.name}" of category ${schema.categoryCode}`,
    );

    if (!(declaration.name in inputs)) {
      throw new EngineError(
        'missing_required_input',
        `Category ${schema.categoryCode} requires "${declaration.name}" (${declaration.label}) at ` +
          `Tier ${tier}, and it was not supplied.`,
      );
    }
  }
}

/** Reject a tier this module does not support, naming the ones it does. */
export function assertTierSupported(
  categoryCode: CategoryCode,
  supported: readonly TierSupport[],
  tier: Tier,
): void {
  if (supported.some((entry) => entry.tier === tier)) {
    return;
  }
  throw new EngineError(
    'unsupported_tier',
    `Category ${categoryCode} cannot be calculated at Tier ${tier}. Supported tiers: ` +
      `${supported.map((entry) => `Tier ${entry.tier}`).join(', ') || 'none'}.`,
  );
}

/** A required scalar, already validated against the schema. */
export function readScalar(inputs: ModuleInputs, name: string): number {
  const value = inputs[name];
  if (!value || value.shape !== 'scalar') {
    throw new EngineError('missing_required_input', `Input "${name}" was not supplied as a scalar.`);
  }
  return value.value;
}

/** A required selection, already validated against the schema. */
export function readSelection(inputs: ModuleInputs, name: string): string {
  const value = inputs[name];
  if (!value || value.shape !== 'selection') {
    throw new EngineError(
      'missing_required_input',
      `Input "${name}" was not supplied as a selection.`,
    );
  }
  return value.value;
}

/** An optional scalar. Absent stays absent: it is never read as zero. */
export function readOptionalScalar(inputs: ModuleInputs, name: string): number | undefined {
  return name in inputs ? readScalar(inputs, name) : undefined;
}

/** An optional selection. Absent stays absent. */
export function readOptionalSelection(inputs: ModuleInputs, name: string): string | undefined {
  return name in inputs ? readSelection(inputs, name) : undefined;
}
