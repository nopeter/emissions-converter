/**
 * Stationary and mobile fuel combustion, Tier 1 style.
 *
 * 2006 IPCC Guidelines, Vol 2 (Energy), Ch 2, Eq 2.1:
 *
 *     Emission(GHG, fuel) = Fuel consumption(fuel) x Emission factor(GHG, fuel)
 *
 * where fuel consumption is expressed in TJ and the emission factor in kg/TJ.
 *
 * How the user's entry reaches TJ depends on what they entered, and the two
 * routes are not equivalent:
 *
 *   a mass or a volume  ->  kilograms  ->  x net calorific value  ->  TJ
 *   an energy figure    ->  TJ directly, with no calorific value involved
 *
 * The second route is genuinely tighter, not merely shorter. The calorific
 * value is usually the widest term in the Eq 3.1 combination — for firewood it
 * is +/-74 % on its own — so a user who knows their energy consumption gets a
 * materially better answer than one who knows their mass. That difference is
 * stated in the audit trail rather than left for the reader to infer.
 *
 * The unit handling itself lives in `conversion.ts`, deliberately apart from
 * this file: a mistake about what a pound is should not be able to look like a
 * mistake about what an emission factor is.
 *
 * This module is pure: no React, no DOM, no I/O, no clock, no randomness. Every
 * numeric emission and calorific value it uses comes from the parameter library;
 * none is written here.
 *
 * It is also all-or-nothing. If any parameter the calculation needs is missing,
 * null or ambiguous, it throws an `EngineError` naming the parameter and the
 * inputs that asked for it, rather than returning a result with a hole in it.
 * That makes the library's own completeness testable: a data-integrity test can
 * assert that every fuel has a calorific value and every Tier 1 (fuel, category,
 * gas) combination has a factor, and a regression in `parameters.json` becomes a
 * failing test instead of a quietly missing gas.
 */
import { parameters } from '../data';
import type {
  CategoryCode,
  EmissionFactor,
  Gas,
  NetCalorificValue,
  ParameterLibrary,
} from '../data/types';
import { CANONICAL_UNITS, convertQuantity } from './conversion';
import { EngineError } from './errors';
import { formatNumber } from './format';
import { findCategoryLabel, findEmissionFactors, findFuel, findNetCalorificValue, GASES } from './lookup';
import type {
  CombustionAudit,
  CombustionOptions,
  CombustionResult,
  ConversionAudit,
  EnergyConversionAudit,
  FactorAudit,
  FuelQuantity,
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
 * The kilogram entry point, kept because kilograms are what the engine works
 * in and most callers have them. It is a thin wrapper over
 * `calculateFuelCombustionFromQuantity`, which is the general one.
 *
 * @param fuelId   a fuel id from the parameter library, e.g. "charcoal"
 * @param massKg   mass of fuel burned, in kilograms
 * @param categoryCode an IPCC category code, e.g. "1A4b" (residential)
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

  return calculateFuelCombustionFromQuantity(
    fuelId,
    { quantity: massKg, unit: CANONICAL_UNITS.mass },
    categoryCode,
    options,
    library,
  );
}

/**
 * Calculate CO2, CH4 and N2O from a quantity of fuel in the unit the user chose.
 *
 * @param fuelId   a fuel id from the parameter library, e.g. "charcoal"
 * @param entered  the quantity, its unit, and whatever that unit needs: a
 *                 density for a volume, a net-or-gross answer for an energy
 * @param categoryCode an IPCC category code, e.g. "1A4b" (residential)
 *
 * Gases are returned separately and are never summed: CO2-equivalent is a
 * derived view (CLAUDE.md rule 4). Biomass CO2 is returned in `memoItems` and
 * is absent from `totalContributing` (rule 3).
 *
 * @throws {EngineError} if the conversion cannot be done (see `conversion.ts`),
 * the fuel or category is unknown, the fuel has no net calorific value and one
 * is needed, or any of the three gases has no factor, a null factor, or more
 * than one matching factor.
 */
export function calculateFuelCombustionFromQuantity(
  fuelId: string,
  entered: FuelQuantity,
  categoryCode: CategoryCode,
  options: CombustionOptions = {},
  library: ParameterLibrary = parameters,
): CombustionResult {
  const fuel = findFuel(library, fuelId);
  if (!fuel) {
    throw new EngineError('unknown_fuel', `No fuel with id "${fuelId}" in the parameter library.`);
  }

  const categoryLabel = findCategoryLabel(library, categoryCode);
  if (categoryLabel === undefined) {
    throw new EngineError(
      'unknown_category',
      `No category with code "${categoryCode}" exists in the parameter library. Known ` +
        `categories: ${Object.keys(library.categories).join(', ')}.`,
    );
  }

  const converted = convertQuantity(fuelId, entered, library);
  const conversion = converted.audit;

  const gaps: ParameterGap[] = conversionGaps(conversion, fuel.label);
  const totalContributing: GasEmission[] = [];
  const memoItems: GasEmission[] = [];
  const factors: FactorAudit[] = [];

  // The calorific value is looked up only on the route that needs it. On the
  // energy route it is not merely unused, it is absent: a fuel with no
  // published calorific value can still be calculated from an energy figure.
  let ncv: NetCalorificValue | null = null;
  let energyConversion: EnergyConversionAudit | null = null;
  let energyTJ: number;
  let massKg: number | null = null;

  if (converted.outcome === 'mass') {
    massKg = converted.massKg;
    ncv = requireNetCalorificValue(library, fuelId, fuel.label);
    energyTJ = massToTerajoules(massKg, ncv);
    energyConversion = ncvConversionAudit(massKg, energyTJ, ncv);
    factors.push(ncvAudit(ncv));

    if (!ncv.verified) {
      gaps.push({
        kind: 'unverified_parameter',
        parameterId: ncv.id,
        message: `The net calorific value for ${ncv.label} has not been verified against its source.`,
      });
    }
  } else {
    energyTJ = converted.energyTJ;
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
      throw new EngineError(
        'missing_emission_factor',
        missingFactorMessage(fuelId, fuel.label, gas, categoryCode, options.vehicleTechnology),
      );
    }

    if (matches.length > 1) {
      throw new EngineError(
        'ambiguous_emission_factor',
        `${matches.length} ${gas} emission factors match fuel "${fuelId}" (${fuel.label}) in ` +
          `category "${categoryCode}": ${matches
            .map((factor) => `${factor.id} (${factor.vehicle_technology ?? 'unspecified'})`)
            .join(', ')}. Choosing between them is a Tier 3 decision about technology, not ` +
          `something the engine may decide. Pass options.vehicleTechnology to select one.`,
      );
    }

    const factor = matches[0];

    if (!Number.isFinite(factor.value)) {
      throw new EngineError(
        'null_parameter_value',
        `${gas} emission factor "${factor.id}" for fuel "${fuelId}" (${fuel.label}) in ` +
          `category "${categoryCode}" has no published value (found ` +
          `${JSON.stringify(factor.value)}). The engine will not estimate one.`,
      );
    }

    const emission = applyEquation2_1(conversion, energyTJ, ncv, factor, options, library);

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
      quantity: conversion.quantity,
      unitId: conversion.unitId,
      massKg,
      categoryCode,
      vehicleTechnology: options.vehicleTechnology ?? null,
      activityDataUncertaintyPercent: options.activityDataUncertaintyPercent ?? null,
    },
    conversion,
    energyConversion,
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

/**
 * Apply Eq 2.1 for one gas, with uncertainty propagated by Vol 1 Ch 3 Eq 3.1.
 *
 * `ncv` is null on the energy route. That is the whole point of the route: the
 * calorific value is not defaulted, not assumed exact and not hidden — it is
 * simply not a term, because it was not used. Anything the conversion itself
 * could not quantify (a density the user supplied, an approximate gross-to-net
 * correction) is carried in from the conversion layer so that the omission
 * travels with the figure it affects.
 */
function applyEquation2_1(
  conversion: ConversionAudit,
  energyTJ: number,
  ncv: NetCalorificValue | null,
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
  const entered = `${formatNumber(conversion.quantity)} ${conversion.unitSymbol}`;

  const candidates: UncertaintyCandidate[] = [
    {
      parameterId: 'activity_data',
      role: 'activity_data',
      label:
        conversion.outcome === 'mass'
          ? 'Fuel mass entered by the user'
          : 'Fuel energy entered by the user',
      value: conversion.resultValue,
      ci95Low: null,
      ci95High: null,
      percent: options.activityDataUncertaintyPercent,
      missingNote:
        `No uncertainty was given for the entered quantity (${entered}), so the activity-data ` +
        `term was left out of the Eq 3.1 combination rather than assumed to be exact.`,
    },
  ];

  if (ncv) {
    candidates.push({
      parameterId: ncv.id,
      role: 'net_calorific_value',
      label: `Net calorific value, ${ncv.label}`,
      value: ncv.value,
      ci95Low: ncv.ci95_low,
      ci95High: ncv.ci95_high,
      declaredAsymmetric: ncv.asymmetric,
    });
  }

  candidates.push({
    parameterId: factor.id,
    role: 'emission_factor',
    label: `${factor.gas} emission factor, ${factor.fuel} (${factor.category})`,
    value: factor.value,
    ci95Low: factor.ci95_low,
    ci95High: factor.ci95_high,
  });

  const uncertainty = combineMultiplicative(
    candidates,
    library.uncertainty_convention.method_multiplication,
    conversion.skippedUncertainty,
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
      factors: ncv ? [ncvAudit(ncv), emissionFactorAudit(factor)] : [emissionFactorAudit(factor)],
    },
  };
}

/** The calorific value, or a refusal to proceed without one. */
function requireNetCalorificValue(
  library: ParameterLibrary,
  fuelId: string,
  fuelLabel: string,
): NetCalorificValue {
  const ncv = findNetCalorificValue(library, fuelId);

  if (!ncv) {
    throw new EngineError(
      'missing_calorific_value',
      `No net calorific value is published for fuel "${fuelId}" (${fuelLabel}), so its mass ` +
        `cannot be converted to energy and Vol 2 Ch 2 Eq 2.1 cannot be applied. The engine ` +
        `will not estimate one. Entering an energy figure instead would avoid needing it.`,
    );
  }

  if (!Number.isFinite(ncv.value)) {
    throw new EngineError(
      'null_parameter_value',
      `Net calorific value "${ncv.id}" for fuel "${fuelId}" (${fuelLabel}) has no published ` +
        `value (found ${JSON.stringify(ncv.value)}). The engine will not estimate one.`,
    );
  }

  return ncv;
}

/** The mass-to-energy step, written out for the audit trail. */
function ncvConversionAudit(
  massKg: number,
  energyTJ: number,
  ncv: NetCalorificValue,
): EnergyConversionAudit {
  const massGg = kilogramsToGigagrams(massKg);

  return {
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
  };
}

/**
 * Caveats the conversion itself introduced.
 *
 * These sit beside the result rather than inside the working, because a figure
 * resting on a density the user typed in is a different kind of figure from one
 * resting on a cited table, and a reader should not have to open a panel to
 * find that out (CLAUDE.md rules 2 and 7).
 */
function conversionGaps(conversion: ConversionAudit, fuelLabel: string): ParameterGap[] {
  const gaps: ParameterGap[] = [];

  for (const step of conversion.steps) {
    if (step.provenance === 'user_provided') {
      gaps.push({
        kind: 'user_supplied_parameter',
        parameterId: step.id,
        message:
          `The density used to turn your ${conversion.unitLabel.toLowerCase()} of ${fuelLabel} ` +
          `into a mass is the one you supplied — no source publishes one here. Every figure ` +
          `below is proportional to it.`,
      });
    }

    if (step.approximate) {
      gaps.push({
        kind: 'approximate_conversion',
        parameterId: step.id,
        message:
          `Your energy figure was given as a gross heating value and converted to the net ` +
          `basis the Guidelines work in using their own rule of thumb, which is an ` +
          `approximation of unstated accuracy. A net figure, where your bill gives one, ` +
          `avoids this step.`,
      });
    }
  }

  return gaps;
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
  fuelId: string,
  fuelLabel: string,
  gas: Gas,
  categoryCode: CategoryCode,
  vehicleTechnology?: string,
): string {
  const technology = vehicleTechnology ? `, technology "${vehicleTechnology}"` : '';
  return (
    `No ${gas} emission factor is published for fuel "${fuelId}" (${fuelLabel}) in category ` +
    `"${categoryCode}"${technology}. The calculation was abandoned rather than returned ` +
    `without ${gas}: the engine does not substitute a similar fuel or estimate a missing factor.`
  );
}
