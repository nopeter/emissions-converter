/**
 * Uncertainty propagation, Approach 1 (2006 IPCC Guidelines, Vol 1 Ch 3).
 *
 * Eq 3.1 (multiplication) combines the terms of a product: a single fuel's
 * emission is energy x emission factor. Eq 3.2 (addition) combines the terms of
 * a sum, which is what a CO2-equivalent total is — three gases, each already
 * multiplied by its own GWP, added together.
 *
 * Two rules from CLAUDE.md are enforced structurally rather than by convention:
 *
 *  - A term with no published confidence interval is skipped and the omission is
 *    recorded. It is never treated as zero uncertainty, because "no published
 *    range" and "no uncertainty" are opposite claims.
 *  - An asymmetric interval is reduced to a symmetric half-width, and the
 *    parameter is named in `symmetrisedParameters` so the simplification travels
 *    with the number.
 *
 * These functions are pure: they read only their arguments. The equation text is
 * passed in from the parameter library so that the library, not this file,
 * remains the authority on how the method is described.
 */
import type {
  ParameterRole,
  SkippedUncertaintyTerm,
  UncertaintyResult,
  UncertaintyTerm,
} from './types';

/** A candidate term for Eq 3.1, before it is known whether it can be included. */
export interface UncertaintyCandidate {
  parameterId: string;
  role: ParameterRole;
  label: string;
  value: number;
  ci95Low: number | null;
  ci95High: number | null;
  /** The record's own asymmetry flag, where the library publishes one. */
  declaredAsymmetric?: boolean;
  /** Overrides the interval: a percentage supplied directly by the caller. */
  percent?: number;
  /** Explains the omission when there is neither an interval nor a percentage. */
  missingNote?: string;
}

/** Relative tolerance for deciding whether an interval is symmetric. */
const SYMMETRY_TOLERANCE = 1e-9;

/**
 * Reduce a published 95% confidence interval to a single percentage.
 *
 * U% = ((high - low) / 2) / value x 100
 *
 * For a symmetric interval this is exact. For an asymmetric one it is the
 * simplification the Guidelines permit for Approach 1, and the caller is told
 * about it via the returned `asymmetric` flag.
 */
export function intervalToPercent(value: number, ci95Low: number, ci95High: number): number {
  const halfWidth = (ci95High - ci95Low) / 2;
  return (halfWidth / value) * 100;
}

/** True when the interval is not symmetric about the central value. */
export function isAsymmetric(value: number, ci95Low: number, ci95High: number): boolean {
  const upper = ci95High - value;
  const lower = value - ci95Low;
  return Math.abs(upper - lower) > SYMMETRY_TOLERANCE * Math.max(Math.abs(value), 1);
}

/**
 * Turn a candidate into either an includable term or a recorded omission.
 *
 * Exported for testing: the skip path is a correctness requirement, not an
 * implementation detail.
 */
export function evaluateCandidate(
  candidate: UncertaintyCandidate,
): { term: UncertaintyTerm } | { skipped: SkippedUncertaintyTerm } {
  const { parameterId, role, label } = candidate;

  if (candidate.percent !== undefined) {
    return {
      term: {
        parameterId,
        role,
        label,
        value: candidate.value,
        ci95Low: candidate.value * (1 - candidate.percent / 100),
        ci95High: candidate.value * (1 + candidate.percent / 100),
        percent: candidate.percent,
        asymmetric: false,
      },
    };
  }

  if (candidate.ci95Low === null || candidate.ci95High === null) {
    const reason =
      candidate.role === 'activity_data' ? 'not_provided' : 'confidence_interval_not_published';
    return {
      skipped: {
        parameterId,
        role,
        label,
        reason,
        note:
          candidate.missingNote ??
          `No 95% confidence interval is published for ${label}, so it was left out of ` +
            `the Eq 3.1 combination. The combined uncertainty is therefore a lower bound.`,
      },
    };
  }

  if (candidate.value === 0) {
    return {
      skipped: {
        parameterId,
        role,
        label,
        reason: 'zero_central_value',
        note:
          `${label} has a central value of zero, so a percentage uncertainty is ` +
          `undefined and the term was left out of the Eq 3.1 combination.`,
      },
    };
  }

  const percent = intervalToPercent(candidate.value, candidate.ci95Low, candidate.ci95High);
  const asymmetric =
    candidate.declaredAsymmetric === true ||
    isAsymmetric(candidate.value, candidate.ci95Low, candidate.ci95High);

  const term: UncertaintyTerm = {
    parameterId,
    role,
    label,
    value: candidate.value,
    ci95Low: candidate.ci95Low,
    ci95High: candidate.ci95High,
    percent,
    asymmetric,
  };

  if (asymmetric) {
    term.symmetrisation =
      `The published 95% interval [${candidate.ci95Low}, ${candidate.ci95High}] is not ` +
      `symmetric about ${candidate.value}. Approach 1 requires a single percentage, so the ` +
      `half-width (${(candidate.ci95High - candidate.ci95Low) / 2}) was used as a symmetric ` +
      `+/-${percent.toFixed(4)}%.`;
  }

  return { term };
}

/**
 * Combine uncertainties for a product of quantities.
 *
 * Vol 1 Ch 3, Eq 3.1:  U_total = sqrt(U1^2 + U2^2 + ... + Un^2)
 *
 * @param equation the equation text, quoted from the parameter library.
 */
export function combineMultiplicative(
  candidates: UncertaintyCandidate[],
  equation: string,
): UncertaintyResult {
  const terms: UncertaintyTerm[] = [];
  const skipped: SkippedUncertaintyTerm[] = [];

  for (const candidate of candidates) {
    const outcome = evaluateCandidate(candidate);
    if ('term' in outcome) {
      terms.push(outcome.term);
    } else {
      skipped.push(outcome.skipped);
    }
  }

  const sumOfSquares = terms.reduce((total, term) => total + term.percent * term.percent, 0);

  return {
    equation,
    percent: terms.length > 0 ? Math.sqrt(sumOfSquares) : null,
    terms,
    skipped,
    incomplete: skipped.length > 0,
    symmetrisedParameters: terms.filter((t) => t.asymmetric).map((t) => t.parameterId),
  };
}

/** A quantity entering a sum, with the uncertainty it already carries. */
export interface AdditiveCandidate {
  parameterId: string;
  role: ParameterRole;
  label: string;
  /** The quantity being added, in the units of the sum. */
  value: number;
  /** Its percentage uncertainty, or null when it has none to contribute. */
  percent: number | null;
  /** Explains the omission when `percent` is null. */
  missingNote?: string;
}

/**
 * Combine uncertainties for a sum of quantities.
 *
 * Vol 1 Ch 3, Eq 3.2:  U_total = sqrt(sum((Ui x xi)^2)) / |sum(xi)|
 *
 * Unlike Eq 3.1 this is weighted: a term's contribution scales with how large it
 * is. That is why a CO2-equivalent total is dominated by whichever gas carries
 * the most CO2-eq, and why the methane and nitrous oxide percentages, large as
 * they are, move the total so little for a fossil fuel.
 *
 * Ui is a percentage and xi a quantity, so the quotient is already a percentage
 * and is not rescaled.
 *
 * @param equation the equation text, quoted from the parameter library.
 * @param alreadySkipped omissions established before this step, carried in so
 *   they travel with the combined figure rather than being lost.
 * @param symmetrisedParameters ids symmetrised in an earlier step, likewise.
 */
export function combineAdditive(
  candidates: AdditiveCandidate[],
  equation: string,
  alreadySkipped: SkippedUncertaintyTerm[] = [],
  symmetrisedParameters: string[] = [],
): UncertaintyResult {
  const terms: UncertaintyTerm[] = [];
  const skipped: SkippedUncertaintyTerm[] = [...alreadySkipped];

  for (const candidate of candidates) {
    const { parameterId, role, label } = candidate;

    if (candidate.percent === null) {
      skipped.push({
        parameterId,
        role,
        label,
        reason: 'confidence_interval_not_published',
        note:
          candidate.missingNote ??
          `${label} carries no quantified uncertainty, so it was left out of the Eq 3.2 ` +
            `combination. The combined uncertainty is therefore a lower bound.`,
      });
      continue;
    }

    if (candidate.value === 0) {
      skipped.push({
        parameterId,
        role,
        label,
        reason: 'zero_central_value',
        note:
          `${label} contributes zero to the sum, so it carries no weight under Eq 3.2 and ` +
          `was left out of the combination.`,
      });
      continue;
    }

    terms.push({
      parameterId,
      role,
      label,
      value: candidate.value,
      ci95Low: candidate.value * (1 - candidate.percent / 100),
      ci95High: candidate.value * (1 + candidate.percent / 100),
      percent: candidate.percent,
      asymmetric: false,
    });
  }

  const sum = terms.reduce((total, term) => total + term.value, 0);
  const sumOfSquares = terms.reduce(
    (total, term) => total + (term.percent * term.value) ** 2,
    0,
  );

  return {
    equation,
    // A zero sum leaves the percentage undefined rather than infinite: every
    // term was skipped above, so there is nothing to divide.
    percent: terms.length > 0 && sum !== 0 ? Math.sqrt(sumOfSquares) / Math.abs(sum) : null,
    terms,
    skipped,
    incomplete: skipped.length > 0,
    symmetrisedParameters: [...symmetrisedParameters],
  };
}
