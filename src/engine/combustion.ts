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
 *
 * It is also all-or-nothing. If any parameter the calculation needs is missing,
 * null or ambiguous, it throws an `EngineError` naming the parameter and the
 * inputs that asked for it, rather than returning a result with a hole in it.
 * That makes the library's own completeness testable: a data-integrity test can
 * assert that every fuel has a calorific value and every Tier 1 (fuel, category,
 * gas) combination has a factor, and a regression in `parameters.json` becomes a
 * failing test instead of a quietly missing gas.
 *
 * `createFuelCombustionModule` at the foot of this file exposes the same
 * calculation through the interface every IPCC category's method implements, so
 * the registry can reach 1A4b and 1A3b the same way it will reach the rest of
 * the Guidelines. The arithmetic has one home, and that is here.
 */
import { parameters } from '../data';
import type {
  CategoryCode,
  EmissionFactor,
  Gas,
  NetCalorificValue,
  ParameterLibrary,
  Tier,
} from '../data/types';
import { EngineError } from './errors';
import { formatNumber } from './format';
import {
  findCategoryLabel,
  findEmissionFactors,
  findFuel,
  findFuelsCalculableIn,
  findNetCalorificValue,
  findTechnologyDisaggregatedTiers,
  findTiersInCategory,
  findVehicleTechnologiesInCategory,
  GASES,
} from './lookup';
import {
  assertTierSupported,
  readOptionalScalar,
  readOptionalSelection,
  readScalar,
  readSelection,
  requiredInputsAt,
  validateInputs,
  type CalculateOptions,
  type CalculationModule,
  type InputDeclaration,
  type InputSchema,
  type ModuleInputs,
  type TierSupport,
} from './module';
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
 *
 * @throws {EngineError} if the mass is invalid, the fuel or category is unknown,
 * the fuel has no net calorific value, or any of the three gases has no factor,
 * a null factor, or more than one matching factor.
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
      `No category with code "${categoryCode}" exists in the parameter library. Known ` +
        `categories: ${Object.keys(library.categories).join(', ')}.`,
    );
  }

  const ncv = findNetCalorificValue(library, fuelId);
  if (!ncv) {
    throw new EngineError(
      'missing_calorific_value',
      `No net calorific value is published for fuel "${fuelId}" (${fuel.label}), so its mass ` +
        `cannot be converted to energy and Vol 2 Ch 2 Eq 2.1 cannot be applied. The engine ` +
        `will not estimate one.`,
    );
  }

  if (!Number.isFinite(ncv.value)) {
    throw new EngineError(
      'null_parameter_value',
      `Net calorific value "${ncv.id}" for fuel "${fuelId}" (${fuel.label}) has no published ` +
        `value (found ${JSON.stringify(ncv.value)}). The engine will not estimate one.`,
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

/**
 * The method identifier for fuel combustion.
 *
 * One method, many categories: the Guidelines apply Eq 2.1 to every 1A
 * subcategory, changing only which table the factors come from.
 */
export const FUEL_COMBUSTION_MODULE_ID = 'fuel_combustion';

/** Input names this module declares. Used by the module and by its tests. */
export const FUEL_COMBUSTION_INPUTS = {
  fuel: 'fuel',
  mass: 'mass',
  vehicleTechnology: 'vehicleTechnology',
  activityDataUncertaintyPercent: 'activityDataUncertaintyPercent',
} as const;

/** The unit the calculator takes fuel quantities in. */
const MASS_UNIT = 'kg';

/** The unit an uncertainty is expressed in, per the library's own convention. */
const PERCENT_UNIT = '%';

function fuelCombustionSchema(library: ParameterLibrary, categoryCode: CategoryCode): InputSchema {
  const tiers = findTiersInCategory(library, categoryCode);
  const technologyTiers = findTechnologyDisaggregatedTiers(library, categoryCode);

  const inputs: InputDeclaration[] = [
    {
      name: FUEL_COMBUSTION_INPUTS.fuel,
      label: 'Fuel',
      shape: 'selection',
      unit: null,
      description:
        'Which fuel was burned. Only fuels the library publishes a complete factor set for in ' +
        'this category are offered; a similar fuel is never substituted.',
      availableAtTiers: tiers,
      requiredAtTiers: tiers,
      options: findFuelsCalculableIn(library, categoryCode).map((fuel) => ({
        value: fuel.id,
        label: fuel.label,
      })),
    },
    {
      name: FUEL_COMBUSTION_INPUTS.mass,
      label: 'Mass burned',
      shape: 'scalar',
      unit: MASS_UNIT,
      description: 'Mass of fuel burned, which the net calorific value converts to energy.',
      availableAtTiers: tiers,
      requiredAtTiers: tiers,
    },
  ];

  if (technologyTiers.length > 0) {
    inputs.push({
      name: FUEL_COMBUSTION_INPUTS.vehicleTechnology,
      label: 'Vehicle technology',
      shape: 'selection',
      unit: null,
      description:
        'Which technology the fuel was burned in. The Guidelines publish a separate factor per ' +
        'technology, so this selects between them; it is not accepted at tiers that use a ' +
        'single default factor.',
      availableAtTiers: technologyTiers,
      requiredAtTiers: technologyTiers,
      options: findVehicleTechnologiesInCategory(library, categoryCode),
    });
  }

  inputs.push({
    name: FUEL_COMBUSTION_INPUTS.activityDataUncertaintyPercent,
    label: 'Uncertainty of the entered mass',
    shape: 'scalar',
    unit: PERCENT_UNIT,
    description:
      'Percentage uncertainty of the activity data. Left out of the Eq 3.1 combination when not ' +
      'given, rather than assumed to be zero.',
    availableAtTiers: tiers,
    requiredAtTiers: [],
  });

  return { categoryCode, inputs };
}

function fuelCombustionTiers(
  library: ParameterLibrary,
  categoryCode: CategoryCode,
): TierSupport[] {
  const schema = fuelCombustionSchema(library, categoryCode);
  const technologyTiers = findTechnologyDisaggregatedTiers(library, categoryCode);

  return findTiersInCategory(library, categoryCode).map((tier) => ({
    tier,
    requires: technologyTiers.includes(tier)
      ? 'Factors disaggregated by technology (Vol 2 Ch 3, Table 3.2.2). The technology must be ' +
        'named before a single factor can be selected.'
      : 'The default factors the Guidelines publish for this category, applied to a fuel mass.',
    requiredInputs: requiredInputsAt(schema, tier).map((input) => input.name),
  }));
}

/**
 * Fuel combustion as a calculation module, bound to one category.
 *
 * The arithmetic is `calculateFuelCombustion` above and is unchanged: this
 * wraps it in the interface every category's method implements, so that 1A4b and
 * 1A3b can be reached through the registry the same way a future 1B1a or 4A1
 * will be. Two categories, two instances — each declaring the fuels, tiers and
 * technologies the library actually publishes for it.
 */
export function createFuelCombustionModule(
  categoryCode: CategoryCode,
): CalculationModule<CombustionResult> {
  return {
    id: FUEL_COMBUSTION_MODULE_ID,
    label: 'Fuel combustion (Vol 2 Ch 2, Eq 2.1)',
    categoryCode,

    declareInputs(): InputSchema {
      return fuelCombustionSchema(parameters, categoryCode);
    },

    availableTiers(): readonly TierSupport[] {
      return fuelCombustionTiers(parameters, categoryCode);
    },

    calculate(inputs: ModuleInputs, tier: Tier, options: CalculateOptions = {}): CombustionResult {
      const library = options.library ?? parameters;

      assertTierSupported(categoryCode, fuelCombustionTiers(library, categoryCode), tier);
      validateInputs(fuelCombustionSchema(library, categoryCode), inputs, tier);

      return calculateFuelCombustion(
        readSelection(inputs, FUEL_COMBUSTION_INPUTS.fuel),
        readScalar(inputs, FUEL_COMBUSTION_INPUTS.mass),
        categoryCode,
        {
          vehicleTechnology: readOptionalSelection(
            inputs,
            FUEL_COMBUSTION_INPUTS.vehicleTechnology,
          ),
          activityDataUncertaintyPercent: readOptionalScalar(
            inputs,
            FUEL_COMBUSTION_INPUTS.activityDataUncertaintyPercent,
          ),
        },
        library,
      );
    },
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
