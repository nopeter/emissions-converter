/**
 * Reading the parameter library.
 *
 * Lookups are strict and total: they either return the record that was asked
 * for or say nothing was found. No fallbacks, no nearest-match, no substituting
 * a similar fuel (CLAUDE.md rule 7).
 */
import type {
  CategoryCode,
  EmissionFactor,
  Fuel,
  Gas,
  NetCalorificValue,
  ParameterLibrary,
  Tier,
} from '../data/types';

/** Display order for the three gases. An ordering, not a parameter. */
export const GASES: readonly Gas[] = ['CO2', 'CH4', 'N2O'];

export function findFuel(library: ParameterLibrary, fuelId: string): Fuel | undefined {
  return library.fuels.find((fuel) => fuel.id === fuelId);
}

export function findNetCalorificValue(
  library: ParameterLibrary,
  fuelId: string,
): NetCalorificValue | undefined {
  return library.net_calorific_values.find((ncv) => ncv.fuel === fuelId);
}

export function findCategoryLabel(
  library: ParameterLibrary,
  category: CategoryCode,
): string | undefined {
  return library.categories[category];
}

/**
 * Every emission factor matching a fuel, category and gas.
 *
 * Returning a list rather than a single record is deliberate. Vol 2 Ch 3 Table
 * 3.2.2 publishes several technology-specific factors for the same fuel and gas,
 * and picking one of them silently would misrepresent a Tier 3 choice as a
 * Tier 1 default. The caller decides what to do with more than one match.
 */
export function findEmissionFactors(
  library: ParameterLibrary,
  fuelId: string,
  category: CategoryCode,
  gas: Gas,
  vehicleTechnology?: string,
): EmissionFactor[] {
  const matches = library.emission_factors.filter(
    (factor) => factor.fuel === fuelId && factor.category === category && factor.gas === gas,
  );

  if (vehicleTechnology === undefined) {
    return matches;
  }

  // The technology dimension exists only for the gases Table 3.2.2 disaggregates.
  // Petrol CO2 comes from Table 3.2.1 and has no technology variants, so a
  // technology selection must not filter it away — it applies to CH4 and N2O.
  const technologySpecific = matches.filter((factor) => factor.vehicle_technology !== undefined);
  if (technologySpecific.length === 0) {
    return matches;
  }

  return technologySpecific.filter((factor) => factor.vehicle_technology === vehicleTechnology);
}

/** Every emission factor published for one category, whatever the fuel or gas. */
export function findFactorsInCategory(
  library: ParameterLibrary,
  category: CategoryCode,
): EmissionFactor[] {
  return library.emission_factors.filter((factor) => factor.category === category);
}

/**
 * The fuels a category can actually be calculated for.
 *
 * A fuel qualifies only when the library publishes a factor for every gas the
 * engine reports. A partial set is not a partial answer: the engine throws on
 * it, so offering the fuel would be offering a calculation that cannot be done.
 */
export function findFuelsCalculableIn(library: ParameterLibrary, category: CategoryCode): Fuel[] {
  return library.fuels.filter((fuel) =>
    GASES.every((gas) => findEmissionFactors(library, fuel.id, category, gas).length > 0),
  );
}

/**
 * The tiers the library actually publishes factors at for one category.
 *
 * Derived, not declared. A module's supported tiers are a fact about the data it
 * has, so a Tier 3 factor arriving in the library is what makes Tier 3 available
 * — not an edit to the module.
 */
export function findTiersInCategory(library: ParameterLibrary, category: CategoryCode): Tier[] {
  const tiers = new Set(findFactorsInCategory(library, category).map((factor) => factor.tier));
  return [...tiers].sort((a, b) => a - b);
}

/**
 * The tiers whose factors in this category are disaggregated by technology.
 *
 * These are the tiers at which the caller must name a technology before a single
 * factor can be selected (Vol 2 Ch 3 Table 3.2.2).
 */
export function findTechnologyDisaggregatedTiers(
  library: ParameterLibrary,
  category: CategoryCode,
): Tier[] {
  const tiers = new Set(
    findFactorsInCategory(library, category)
      .filter((factor) => factor.vehicle_technology !== undefined)
      .map((factor) => factor.tier),
  );
  return [...tiers].sort((a, b) => a - b);
}

/**
 * Every vehicle technology published in one category, with its label.
 *
 * Labels are the library's own `vehicle_technology_label`. Where a record
 * carries none, the raw identifier is used rather than a description invented
 * here.
 */
export function findVehicleTechnologiesInCategory(
  library: ParameterLibrary,
  category: CategoryCode,
): Array<{ value: string; label: string }> {
  const byValue = new Map<string, string>();

  for (const factor of findFactorsInCategory(library, category)) {
    const value = factor.vehicle_technology;
    if (value === undefined) {
      continue;
    }
    const label = factor.vehicle_technology_label;
    if (label !== undefined) {
      byValue.set(value, label);
    } else if (!byValue.has(value)) {
      byValue.set(value, value);
    }
  }

  return [...byValue].map(([value, label]) => ({ value, label }));
}
