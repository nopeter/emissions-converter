/**
 * Unit handling for the mass-to-energy step.
 *
 * The only numbers defined in this file are SI prefix definitions. They are not
 * emission or calorific parameters — nothing here was measured, and nothing here
 * could be revised by a better source. Every measured quantity comes from
 * `src/data/parameters.json`.
 */
import type { NetCalorificValue } from '../data/types';
import { EngineError } from './errors';

/** SI definitions: 1 kg = 10^3 g, 1 Gg = 10^9 g. */
const GRAMS_PER_KILOGRAM = 1e3;
const GRAMS_PER_GIGAGRAM = 1e9;

/** 1 kg = 1e-6 Gg. Derived, not typed in, so the arithmetic is visible. */
export const GIGAGRAMS_PER_KILOGRAM = GRAMS_PER_KILOGRAM / GRAMS_PER_GIGAGRAM;

/** The unit the parameter library publishes net calorific values in. */
export const EXPECTED_NCV_UNIT = 'TJ/Gg';

/** The unit the parameter library publishes emission factors in. */
export const EXPECTED_EMISSION_FACTOR_UNIT = 'kg/TJ';

export function kilogramsToGigagrams(massKg: number): number {
  return massKg * GIGAGRAMS_PER_KILOGRAM;
}

/**
 * Convert a fuel mass to the energy content used by Vol 2 Ch 2 Eq 2.1.
 *
 * Energy (TJ) = mass (Gg) x NCV (TJ/Gg)
 *
 * The NCV's declared unit is checked rather than assumed: if the library is ever
 * revised to publish, say, TJ/kt, this throws instead of returning a number that
 * is wrong by three orders of magnitude.
 */
export function massToTerajoules(massKg: number, ncv: NetCalorificValue): number {
  if (ncv.unit !== EXPECTED_NCV_UNIT) {
    throw new EngineError(
      'unexpected_unit',
      `Net calorific value "${ncv.id}" is published in ${ncv.unit}, but the engine ` +
        `only knows how to apply ${EXPECTED_NCV_UNIT}.`,
    );
  }

  return kilogramsToGigagrams(massKg) * ncv.value;
}
