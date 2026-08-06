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
import type { CategoryCode, Density, Fuel, FuelPreset, Unit, UnitMeasure } from '../data/types';
import { densityUnits, findEmissionFactors, findUnit, GASES, quantityUnits } from '../engine';

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

/** How the unit control groups its options. */
export interface UnitGroup {
  measures: UnitMeasure;
  /** e.g. "By weight". Wording for a non-specialist, not the SI term. */
  label: string;
  units: Unit[];
}

const GROUP_LABEL: Record<UnitMeasure, string> = {
  mass: 'By weight',
  volume: 'By volume',
  energy: 'By energy',
  density: 'Density',
};

const GROUP_ORDER: UnitMeasure[] = ['mass', 'volume', 'energy'];

/**
 * The units this fuel may be entered in.
 *
 * Mass and energy are always offered. Mass because the calorific value in the
 * library converts it; energy because the energy route needs no fuel-specific
 * parameter at all — Eq 2.1 takes terajoules whatever was burnt.
 *
 * Volume is offered only where the library carries a density record for the
 * fuel. The record is empty, and stays empty, so it supplies no number; what it
 * does say is that this is a fuel somebody buys by volume, which is the
 * question being asked here. Offering litres of firewood would be answering a
 * question nobody asked.
 */
export function unitsForFuel(fuel: Fuel): Unit[] {
  const sellsByVolume = fuelDensityRecord(fuel) !== undefined;

  return quantityUnits(parameters).filter(
    (unit) => unit.measures !== 'volume' || sellsByVolume,
  );
}

/** The same list, grouped for a `<select>` with `<optgroup>`s. */
export function unitGroupsForFuel(fuel: Fuel): UnitGroup[] {
  const units = unitsForFuel(fuel);

  return GROUP_ORDER.map((measures) => ({
    measures,
    label: GROUP_LABEL[measures],
    units: units.filter((unit) => unit.measures === measures),
  })).filter((group) => group.units.length > 0);
}

/**
 * The units a density may be given in, the one this fuel's suppliers quote first.
 *
 * The library's (empty) density record still names a unit, and that is the
 * useful part of it: kilograms per litre for the liquids, kilograms per cubic
 * metre for gas. Someone reading a kerosene spec sheet will have the first;
 * someone reading a gas network's figures will have the second.
 */
export function densityUnitsForFuel(fuel: Fuel): Unit[] {
  const preferred = fuelDensityRecord(fuel)?.unit;

  return [...densityUnits(parameters)].sort(
    (a, b) => Number(b.id === preferred) - Number(a.id === preferred),
  );
}

/** The library's density record for a fuel, empty though it is. */
export function fuelDensityRecord(fuel: Fuel): Density | undefined {
  return parameters.densities.find((record) => record.fuel === fuel.id);
}

/**
 * The fuel's preselected unit: the one it is actually sold in.
 *
 * Falls back to the first unit offered rather than crashing if the library ever
 * names a default the fuel does not offer, which the data-integrity tests are
 * what should catch.
 */
export function defaultUnitForFuel(fuel: Fuel): Unit {
  const offered = unitsForFuel(fuel);
  return offered.find((unit) => unit.id === fuel.default_unit) ?? offered[0];
}

/**
 * The fuel's one-tap purchase quantities, for the unit currently selected.
 *
 * Empty unless the library publishes presets in that unit. A 12.5 kg cylinder
 * preset is meaningless once the user has switched to pounds, so it is not
 * offered there rather than silently converted.
 */
export function presetsForUnit(fuel: Fuel, unitId: string): FuelPreset[] {
  return (fuel.presets ?? []).filter((preset) => preset.unit === unitId);
}

export function findUnitById(unitId: string): Unit | undefined {
  return findUnit(parameters, unitId);
}
