/**
 * Display formatting.
 *
 * Presentation only: these functions choose how many digits to show, never
 * what the digits are. No value is scaled, combined or rounded into a
 * different quantity — the engine's numbers go in and a string comes out.
 *
 * The engine has its own `formatNumber` for audit strings, which keeps twelve
 * significant digits so a reviewer can re-derive the arithmetic by hand. That
 * is the wrong precision for a headline figure, which is why this exists
 * separately rather than reusing it.
 */
import type { Gas, GwpOrigin, Provenance } from '../data/types';
import type { ParameterRole } from '../engine';

const QUANTITY = new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 4 });
const PERCENT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** A physical quantity, to four significant figures. */
export function formatQuantity(value: number): string {
  return QUANTITY.format(value);
}

/** A percentage, to one decimal place. */
export function formatPercent(value: number): string {
  return PERCENT.format(value);
}

/** Chemical formulae as they should be typeset, not as they are keyed. */
export const GAS_FORMULA: Record<Gas, string> = {
  CO2: 'CO₂',
  CH4: 'CH₄',
  N2O: 'N₂O',
};

export const GAS_NAME: Record<Gas, string> = {
  CO2: 'Carbon dioxide',
  CH4: 'Methane',
  N2O: 'Nitrous oxide',
};

/** The three provenance classes, as the chips label them. */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  ipcc: 'IPCC',
  external: 'External',
  assumed: 'Assumed',
};

/** What part a parameter played in the calculation. */
export const ROLE_LABEL: Record<ParameterRole, string> = {
  activity_data: 'Activity data',
  net_calorific_value: 'Net calorific value',
  emission_factor: 'Emission factor',
  global_warming_potential: 'Global warming potential',
};

/** How a GWP set's methane origin reads in a label. */
export const GWP_ORIGIN_LABEL: Record<GwpOrigin, string> = {
  all: 'all sources',
  fossil: 'fossil',
  non_fossil: 'non-fossil',
};
