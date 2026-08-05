/**
 * What the calculator offers, derived from the parameter library.
 *
 * A fuel is offered in a category exactly when the library publishes an
 * emission factor for all three gases there. That is the same completeness
 * condition `src/engine/__tests__/data-integrity.test.ts` holds the library
 * to, so the eight offered combinations are the seven on its MVP list plus
 * petrol in road transport, which the test excludes from that list only
 * because it needs a Tier 3 technology choice before it can be calculated.
 *
 * Nothing is hard-coded here. Had this file carried its own list of fuel ids,
 * a factor disappearing from the library would show up as a runtime engine
 * error in front of a user; derived this way, the combination simply stops
 * being offered and the data-integrity test is what fails.
 *
 * No arithmetic: this module reads and labels records, it does not compute.
 */
import { parameters } from '../data';
import type { CategoryCode, Fuel } from '../data/types';
import { findEmissionFactors, GASES } from '../engine';

export interface OfferedFuel {
  id: string;
  label: string;
  fuel: Fuel;
}

export interface OfferedCategory {
  code: CategoryCode;
  /** Short name for the control, e.g. "Residential". */
  label: string;
  /** The library's own full path, e.g. "Energy > ... > Residential". */
  fullLabel: string;
  fuels: OfferedFuel[];
}

/** A Tier 3 technology the user must choose between. */
export interface TechnologyOption {
  value: string;
  label: string;
  /** False when the library publishes no plain-English label for it. */
  labelled: boolean;
}

/** How a fuel is normally bought, when that is not by mass. */
export interface ConversionNote {
  /** e.g. "the litre", "the cubic metre or the kilowatt-hour". */
  soldBy: string;
  /** Id of the unsourced density record that blocks the conversion. */
  densityId: string;
}

function hasCompleteFactorSet(fuelId: string, category: CategoryCode): boolean {
  return GASES.every((gas) => findEmissionFactors(parameters, fuelId, category, gas).length > 0);
}

/** "Energy > Fuel combustion > Other sectors > Residential" -> "Residential". */
function shortCategoryLabel(fullLabel: string): string {
  const parts = fullLabel.split('>');
  return (parts[parts.length - 1] ?? fullLabel).trim();
}

export const CATEGORIES: OfferedCategory[] = Object.entries(parameters.categories)
  .map(([code, fullLabel]) => ({
    code,
    fullLabel,
    label: shortCategoryLabel(fullLabel),
    fuels: parameters.fuels
      .filter((fuel) => hasCompleteFactorSet(fuel.id, code))
      .map((fuel) => ({ id: fuel.id, label: fuel.label, fuel })),
  }))
  .filter((category) => category.fuels.length > 0);

export function findCategory(code: CategoryCode): OfferedCategory | undefined {
  return CATEGORIES.find((category) => category.code === code);
}

export function findOfferedFuel(code: CategoryCode, fuelId: string): OfferedFuel | undefined {
  return findCategory(code)?.fuels.find((fuel) => fuel.id === fuelId);
}

/**
 * The Tier 3 technologies published for this fuel and category.
 *
 * Empty when the library publishes one factor per gas, which is the ordinary
 * case. Non-empty means the engine will throw `ambiguous_emission_factor`
 * until the user picks one — choosing on their behalf would present a Tier 3
 * decision as a Tier 1 default.
 *
 * Labels are the library's `vehicle_technology_label`. Where a record does not
 * carry one, the raw identifier is shown rather than a description invented
 * here.
 */
export function technologyOptions(fuelId: string, category: CategoryCode): TechnologyOption[] {
  const byValue = new Map<string, TechnologyOption>();

  for (const gas of GASES) {
    for (const factor of findEmissionFactors(parameters, fuelId, category, gas)) {
      const value = factor.vehicle_technology;
      if (value === undefined) {
        continue;
      }
      const label = factor.vehicle_technology_label;
      if (label !== undefined) {
        byValue.set(value, { value, label, labelled: true });
      } else if (!byValue.has(value)) {
        byValue.set(value, { value, label: value, labelled: false });
      }
    }
  }

  return [...byValue.values()];
}

/** A GWP set the user can switch the total to. */
export interface OfferedGwpSet {
  id: string;
  label: string;
  /** True when the set publishes separate fossil and non-fossil methane GWPs. */
  fossilSplit: boolean;
}

/**
 * Every GWP set in the library, in library order.
 *
 * All of them are offered. Unlike a fuel, a GWP set has no completeness
 * condition to meet: the library holds five, the user picks one, and the one in
 * use is named beside the result (CLAUDE.md rule 4).
 */
export const GWP_SETS: OfferedGwpSet[] = parameters.gwp_sets.map((set) => ({
  id: set.id,
  label: set.label,
  fossilSplit: set.fossil_split,
}));

/**
 * The set the total uses until the user chooses another.
 *
 * AR6 is the most recent assessment. Named by id rather than by position so
 * that reordering the library cannot silently change which GWPs every default
 * result is computed with; if the id ever disappears, the first set in the
 * library is used instead of crashing, and the test suite fails.
 */
const PREFERRED_DEFAULT_GWP_SET_ID = 'gwp_ar6_100';

export const DEFAULT_GWP_SET_ID: string =
  GWP_SETS.find((set) => set.id === PREFERRED_DEFAULT_GWP_SET_ID)?.id ?? GWP_SETS[0].id;

const UNIT_WORDS: Record<string, string> = {
  litre: 'the litre',
  m3: 'the cubic metre',
  kWh: 'the kilowatt-hour',
};

/**
 * Whether this fuel is normally bought in something other than kilograms, and
 * is therefore blocked from a volume input by an unsourced density.
 *
 * Returns null for fuels sold by mass, and for any fuel whose density has
 * since been sourced — at which point the note would be untrue.
 */
export function conversionNote(fuel: Fuel): ConversionNote | null {
  if (fuel.sold_by === 'mass') {
    return null;
  }

  const density = parameters.densities.find((record) => record.fuel === fuel.id);
  if (!density || density.value !== null) {
    return null;
  }

  const words = fuel.common_units.map((unit) => UNIT_WORDS[unit]).filter(Boolean) as string[];

  return {
    soldBy: words.length > 0 ? words.join(' or ') : 'a unit other than mass',
    densityId: density.id,
  };
}
