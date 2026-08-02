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

  return matches.filter((factor) => factor.vehicle_technology === vehicleTechnology);
}
