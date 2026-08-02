/**
 * Stationary and mobile fuel combustion, Tier 1 style.
 *
 * 2006 IPCC Guidelines, Vol 2 (Energy), Ch 2, Eq 2.1:
 *
 *     Emission(GHG, fuel) = Fuel consumption(fuel) x Emission factor(GHG, fuel)
 *
 * where fuel consumption is expressed in TJ and the emission factor in kg/TJ.
 * The mass the user enters is converted to TJ first, via the fuel's net
 * calorific value (Vol 2 Ch 1 Table 1.2).
 *
 * This module is pure: no React, no DOM, no I/O, no clock, no randomness. Every
 * numeric emission and calorific value it uses comes from the parameter library;
 * none is written here.
 */
import { parameters } from '../data';
import type {
  CategoryCode,
  EmissionFactor,
  Gas,
  NetCalorificValue,
  ParameterLibrary,
} from '../data/types';
import { EngineError } from './errors';
import { formatNumber } from './format';
import { findCategoryLabel, findEmissionFactors, findFuel, findNetCalorificValue, GASES } from './lookup';
import type {
  CombustionAudit,
  CombustionOptions,
  CombustionResult,
  FactorAudit,
  GasEmission,
  ParameterGap,
} from './types';
import { EXPECTED_EMISSION_FACTOR_UNIT, kilogramsToGigagrams, massToTerajoules } from './units';
import { combineMultiplicative, type UncertaintyCandidate } from './uncertainty';

/** Vol 2 Ch 2 Eq 2.1, written out for the audit trail. */
const EQUATION_2_1 =
  '2006 IPCC Guidelines, Vol 2 (Energy), Ch 2, Eq 2.1: ' +
  'Emission (kg) = Fuel consumption (TJ) x Emission factor (kg/TJ)';

/** The mass-to-energy step, written out for the audit trail. */
const EQUATION_ENERGY =
  'Fuel consumption (TJ) = Mass (Gg) x Net calorific value (TJ/Gg), ' +
  'with 1 kg = 1e-6 Gg. Net calorific values: Vol 2 (Energy), Ch 1, Table 1.2.';

/**
 * Calculate CO2, CH4 and N2O from burning a mass of one fuel in one category.
 *
 * @param fuelId   a fuel id from the parameter library, e.g. "charcoal"
 * @param massKg   mass of fuel burned, in kilograms
 * @param categoryCode an IPCC category code, e.g. "1A4b" (residential)
 *
 * Gases are returned separately and are never summed: CO2-equivalent is a
 * derived view that this engine does not yet produce (CLAUDE.md rule 4).
 * Biomass CO2 is returned in `memoItems` and is absent from `totalContributing`
 * (rule 3).
 */
export function calculateFuelCombustion(
  fuelId: string,
  massKg: number,
  categoryCode: CategoryCode,
  options: CombustionOptions = {},
  library: ParameterLibrary = parameters,
): CombustionResult {
  if (!Number.isFinite(massKg) || massKg < 0) {
    throw new EngineError(
      'invalid_mass',
      `Mass must be a finite, non-negative number of kilograms; received ${massKg}.`,
    );
  }

  const fuel = findFuel(library, fuelId);
  if (!fuel) {
    throw new EngineError('unknown_fuel', `No fuel with id "${fuelId}" in the parameter library.`);
  }

  const categoryLabel = findCategoryLabel(library, categoryCode);
  if (categoryLabel === undefined) {
    throw new EngineError(
      'unknown_category',
      `No category with code "${categoryCode}" in the parameter library.`,
    );
  }

  const ncv = findNetCalorificValue(library, fuelId);
  if (!ncv) {
    throw new EngineError(
      'missing_calorific_value',
      `No net calorific value published for "${fuelId}". The engine will not estimate one.`,
    );
  }

  const massGg = kilogramsToGigagrams(massKg);
  const energyTJ = massToTerajoules(massKg, ncv);

  const gaps: ParameterGap[] = [];
  const totalContributing: GasEmission[] = [];
  const memoItems: GasEmission[] = [];
  const factors: FactorAudit[] = [ncvAudit(ncv)];

  if (!ncv.verified) {
    gaps.push({
      kind: 'unverified_parameter',
      parameterId: ncv.id,
      message: `The net calorific value for ${ncv.label} has not been verified against its source.`,
    });
  }

  for (const gas of GASES) {
    const matches = findEmissionFactors(
      library,
      fuelId,
      categoryCode,
      gas,
      options.vehicleTechnology,
    );

    if (matches.length === 0) {
      gaps.push({
        kind: 'missing_emission_factor',
        gas,
        message: missingFactorMessage(fuel.label, gas, categoryCode, options.vehicleTechnology),
      });
      continue;
    }

    if (matches.length > 1) {
      gaps.push({
        kind: 'ambiguous_emission_factor',
        gas,
        message:
          `${matches.length} technology-specific ${gas} factors are published for ` +
          `${fuel.label} in category ${categoryCode} (${matches
            .map((factor) => factor.vehicle_technology ?? 'unspecified')
            .join(', ')}). Choosing one is a Tier 3 decision, so no ${gas} figure was ` +
          `produced until a technology is selected.`,
      });
      continue;
    }

    const factor = matches[0];
    const emission = applyEquation2_1(massKg, energyTJ, ncv, factor, options, library);

    factors.push(emission.audit.factors[emission.audit.factors.length - 1]);

    if (!factor.verified) {
      gaps.push({
        kind: 'unverified_parameter',
        gas,
        parameterId: factor.id,
        message: `The ${gas} emission factor ${factor.id} has not been verified against its source.`,
      });
    }

    if (emission.memoItem) {
      memoItems.push(emission);
    } else {
      totalContributing.push(emission);
    }
  }

  const audit: CombustionAudit = {
    library: {
      schemaVersion: library.schema_version,
      libraryVersion: library.library_version,
      updated: library.updated,
      methodology: library.methodology,
    },
    inputs: {
      fuelId,
      massKg,
      categoryCode,
      vehicleTechnology: options.vehicleTechnology ?? null,
      activityDataUncertaintyPercent: options.activityDataUncertaintyPercent ?? null,
    },
    energyConversion: {
      equation: EQUATION_ENERGY,
      workings:
        `${formatNumber(massKg)} kg = ${formatNumber(massGg)} Gg; ` +
        `${formatNumber(massGg)} Gg x ${formatNumber(ncv.value)} ${ncv.unit} = ` +
        `${formatNumber(energyTJ)} TJ`,
      massKg,
      massGg,
      ncvValue: ncv.value,
      ncvUnit: ncv.unit,
      energyTJ,
    },
    factors,
  };

  return {
    fuelId,
    fuelLabel: fuel.label,
    biomass: fuel.biomass,
    categoryCode,
    categoryLabel,
    massKg,
    energyTJ,
    totalContributing,
    memoItems,
    gaps,
    audit,
  };
}

/** Apply Eq 2.1 for one gas, with uncertainty propagated by Vol 1 Ch 3 Eq 3.1. */
function applyEquation2_1(
  massKg: number,
  energyTJ: number,
  ncv: NetCalorificValue,
  factor: EmissionFactor,
  options: CombustionOptions,
  library: ParameterLibrary,
): GasEmission {
  if (factor.unit !== EXPECTED_EMISSION_FACTOR_UNIT) {
    throw new EngineError(
      'unexpected_unit',
      `Emission factor "${factor.id}" is published in ${factor.unit}, but the engine only ` +
        `knows how to apply ${EXPECTED_EMISSION_FACTOR_UNIT}.`,
    );
  }

  const kg = energyTJ * factor.value;

  const candidates: UncertaintyCandidate[] = [
    {
      parameterId: 'activity_data',
      role: 'activity_data',
      label: 'Fuel mass entered by the user',
      value: massKg,
      ci95Low: null,
      ci95High: null,
      percent: options.activityDataUncertaintyPercent,
      missingNote:
        'No uncertainty was given for the entered fuel mass, so the activity-data term ' +
        'was left out of the Eq 3.1 combination rather than assumed to be exact.',
    },
    {
      parameterId: ncv.id,
      role: 'net_calorific_value',
      label: `Net calorific value, ${ncv.label}`,
      value: ncv.value,
      ci95Low: ncv.ci95_low,
      ci95High: ncv.ci95_high,
      declaredAsymmetric: ncv.asymmetric,
    },
    {
      parameterId: factor.id,
      role: 'emission_factor',
      label: `${factor.gas} emission factor, ${factor.fuel} (${factor.category})`,
      value: factor.value,
      ci95Low: factor.ci95_low,
      ci95High: factor.ci95_high,
    },
  ];

  const uncertainty = combineMultiplicative(
    candidates,
    library.uncertainty_convention.method_multiplication,
  );

  return {
    gas: factor.gas,
    kg,
    memoItem: factor.memo_item === true,
    memoReason: factor.memo_reason ?? null,
    tier: factor.tier,
    uncertainty,
    audit: {
      gas: factor.gas,
      equation: EQUATION_2_1,
      workings:
        `${formatNumber(energyTJ)} TJ x ${formatNumber(factor.value)} ${factor.unit} = ` +
        `${formatNumber(kg)} kg ${factor.gas}`,
      fuelConsumptionTJ: energyTJ,
      emissionFactorKgPerTJ: factor.value,
      factors: [ncvAudit(ncv), emissionFactorAudit(factor)],
    },
  };
}

function ncvAudit(ncv: NetCalorificValue): FactorAudit {
  return {
    parameterId: ncv.id,
    role: 'net_calorific_value',
    label: ncv.label,
    value: ncv.value,
    unit: ncv.unit,
    provenance: ncv.provenance,
    source: ncv.source,
    verified: ncv.verified,
    ci95Low: ncv.ci95_low,
    ci95High: ncv.ci95_high,
    note: ncv.note,
  };
}

function emissionFactorAudit(factor: EmissionFactor): FactorAudit {
  return {
    parameterId: factor.id,
    role: 'emission_factor',
    label: `${factor.gas} emission factor`,
    value: factor.value,
    unit: factor.unit,
    provenance: factor.provenance,
    source: factor.source,
    verified: factor.verified,
    ci95Low: factor.ci95_low,
    ci95High: factor.ci95_high,
    tier: factor.tier,
    note: factor.note,
  };
}

function missingFactorMessage(
  fuelLabel: string,
  gas: Gas,
  categoryCode: CategoryCode,
  vehicleTechnology?: string,
): string {
  const technology = vehicleTechnology ? ` and technology "${vehicleTechnology}"` : '';
  return (
    `No ${gas} emission factor is published for ${fuelLabel} in category ${categoryCode}` +
    `${technology}. No figure was produced: the engine does not substitute a similar fuel ` +
    `or estimate a missing factor.`
  );
}
