/**
 * The conversion layer: what the user entered, turned into what Eq 2.1 needs.
 *
 * This module sits in front of the combustion calculation and is deliberately
 * separate from it. Combustion knows how to apply an emission factor to an
 * amount of energy; it does not know what a pound or a cubic foot is. Keeping
 * the two apart means a conversion mistake cannot be mistaken for an emissions
 * mistake, and the conversion can be tested on its own.
 *
 * Every step returns its factor, its provenance class, its source and its
 * working, and all of it travels into the audit trail. A converted number with
 * no visible chain behind it is exactly the kind of number this product exists
 * not to produce.
 *
 * Three provenance classes apply here, and they are not the parameter classes
 * (see `ConversionProvenance` in `src/data/types.ts`):
 *
 *   exact             a defined relationship — pounds to kilograms, cubic feet
 *                     to cubic metres. Adds no uncertainty, because there is
 *                     nothing about a definition to be uncertain about.
 *   ipcc_approximate  the Guidelines' own gross-to-net rule of thumb. Adds
 *                     uncertainty that the Guidelines do not quantify.
 *   user_provided     a density the user supplied. Applied exactly as given,
 *                     and recorded as a term the engine could not evaluate.
 *
 * Two paths lead out of here. A mass or a volume ends in kilograms, which the
 * net calorific value then turns into energy. Energy entered directly ends in
 * terajoules and skips the calorific value entirely — a real difference, not a
 * shortcut: it removes the widest term from the Eq 3.1 combination rather than
 * hiding it.
 *
 * Pure, like the rest of the engine. The only numeric literals below are 1 and
 * 100, used to turn "about 5 percent lower" into a multiplier; every factor
 * comes from the parameter library.
 */
import { parameters } from '../data';
import type { CalorificBasisConversion, Fuel, ParameterLibrary, Unit } from '../data/types';
import { EngineError } from './errors';
import { formatNumber } from './format';
import { findFuel } from './lookup';
import type {
  ConversionAudit,
  ConversionStep,
  ConvertedQuantity,
  FuelQuantity,
  SkippedUncertaintyTerm,
  UserDensity,
} from './types';

/** The unit each kind of quantity is reduced to before anything else happens. */
export const CANONICAL_UNITS = {
  mass: 'kg',
  volume: 'm3',
  energy: 'TJ',
  density: 'kg/m3',
} as const;

/** Id of the step where the user's own density is applied. */
export const USER_DENSITY_STEP_ID = 'user_density';

export function findUnit(library: ParameterLibrary, unitId: string): Unit | undefined {
  return library.units.find((unit) => unit.id === unitId);
}

/** The units a quantity of fuel may be entered in — everything but densities. */
export function quantityUnits(library: ParameterLibrary): Unit[] {
  return library.units.filter((unit) => unit.measures !== 'density');
}

/** The units a density may be supplied in. */
export function densityUnits(library: ParameterLibrary): Unit[] {
  return library.units.filter((unit) => unit.measures === 'density');
}

/**
 * Convert what the user entered into either a mass in kilograms or an energy in
 * terajoules.
 *
 * @throws {EngineError} if the quantity is not a finite non-negative number, the
 * unit is unknown, a volume was entered without a density, or an energy was
 * entered without saying whether it is net or gross. The engine never fills any
 * of these in for the user (CLAUDE.md rule 7).
 */
export function convertQuantity(
  fuelId: string,
  input: FuelQuantity,
  library: ParameterLibrary = parameters,
): ConvertedQuantity {
  const fuel = findFuel(library, fuelId);
  if (!fuel) {
    throw new EngineError('unknown_fuel', `No fuel with id "${fuelId}" in the parameter library.`);
  }

  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new EngineError(
      'invalid_quantity',
      `The quantity must be a finite, non-negative number; received ${input.quantity}.`,
    );
  }

  const unit = findUnit(library, input.unit);
  if (!unit) {
    throw new EngineError(
      'unknown_unit',
      `No unit with id "${input.unit}" exists in the parameter library. Units it publishes for ` +
        `entering a quantity: ${quantityUnits(library)
          .map((candidate) => candidate.id)
          .join(', ')}.`,
    );
  }

  if (unit.measures === 'density') {
    throw new EngineError(
      'unknown_unit',
      `"${unit.id}" is a unit of density, not a quantity of fuel. A density describes the fuel; ` +
        `it is not an amount of it.`,
    );
  }

  const converted = convertUnit(input.quantity, unit);

  switch (unit.measures) {
    case 'mass':
      return {
        outcome: 'mass',
        massKg: converted.toValue,
        audit: massAudit(unit, input.quantity, [converted], [], massNote(unit)),
      };

    case 'volume':
      return volumeToMass(fuel, unit, input, converted, library);

    case 'energy':
      return energyToTerajoules(fuel, unit, input, converted, library);
  }
}

/** Apply a unit's defined factor: quantity in, canonical quantity out. */
function convertUnit(value: number, unit: Unit): ConversionStep {
  const converted = value * unit.factor;

  return {
    id: unit.id,
    label: `${unit.label} to ${unit.canonical_unit}`,
    provenance: unit.provenance,
    factor: unit.factor,
    factorUnit: `${unit.canonical_unit} per ${unit.symbol}`,
    source: unit.source,
    verified: unit.verified,
    fromValue: value,
    fromUnit: unit.symbol,
    toValue: converted,
    toUnit: unit.canonical_unit,
    workings:
      `${formatNumber(value)} ${unit.symbol} x ${formatNumber(unit.factor)} ` +
      `${unit.canonical_unit}/${unit.symbol} = ${formatNumber(converted)} ${unit.canonical_unit}`,
    approximate: false,
    note: unit.note ?? null,
  };
}

/**
 * Volume to mass, through a density the user supplies.
 *
 * No density in the library has a value: every one is `null` and `unsourced`,
 * deliberately. That is why this asks rather than assumes. A user-supplied
 * density is applied exactly as given — the engine has no standing to second-
 * guess a figure off a supplier's spec sheet — but "exact as applied" is not
 * the same claim as "exact", so the term is recorded as one the Eq 3.1
 * combination could not evaluate.
 */
function volumeToMass(
  fuel: Fuel,
  unit: Unit,
  input: FuelQuantity,
  volumeStep: ConversionStep,
  library: ParameterLibrary,
): ConvertedQuantity {
  const density = requireDensity(fuel, unit, input.density, library);
  const densityUnit = findUnit(library, density.unit);

  if (!densityUnit || densityUnit.measures !== 'density') {
    throw new EngineError(
      'unknown_unit',
      `No density unit with id "${density.unit}" exists in the parameter library. Units it ` +
        `publishes for a density: ${densityUnits(library)
          .map((candidate) => candidate.id)
          .join(', ')}.`,
    );
  }

  if (!Number.isFinite(density.value) || density.value <= 0) {
    throw new EngineError(
      'invalid_density',
      `The density must be a finite number greater than zero; received ${density.value}. A ` +
        `density of zero would make any volume of ${fuel.label} weigh nothing.`,
    );
  }

  const densityStep = convertUnit(density.value, densityUnit);
  const volumeM3 = volumeStep.toValue;
  const densityKgPerM3 = densityStep.toValue;
  const massKg = volumeM3 * densityKgPerM3;

  const applyStep: ConversionStep = {
    id: USER_DENSITY_STEP_ID,
    label: `Volume to mass, using the density you supplied`,
    provenance: 'user_provided',
    factor: densityKgPerM3,
    factorUnit: `${CANONICAL_UNITS.mass} per ${CANONICAL_UNITS.volume}`,
    source:
      `Supplied by you. The parameter library publishes no density for ${fuel.label}: the ` +
      `record ${fuel.blocked_by ?? 'for this fuel'} exists but is deliberately empty, because ` +
      `no citable source for it has been found.`,
    verified: false,
    fromValue: volumeM3,
    fromUnit: CANONICAL_UNITS.volume,
    toValue: massKg,
    toUnit: CANONICAL_UNITS.mass,
    workings:
      `${formatNumber(volumeM3)} ${CANONICAL_UNITS.volume} x ${formatNumber(densityKgPerM3)} ` +
      `${CANONICAL_UNITS.density} = ${formatNumber(massKg)} ${CANONICAL_UNITS.mass}`,
    approximate: false,
    note:
      `Applied exactly as you gave it. Everything below is directly proportional to this ` +
      `figure: a density 10 percent too high makes every emission figure 10 percent too high.`,
  };

  const skipped: SkippedUncertaintyTerm[] = [
    {
      parameterId: USER_DENSITY_STEP_ID,
      role: 'density',
      label: `Density of ${fuel.label}, supplied by you`,
      reason: 'user_provided',
      note:
        `The density came from you, so there is no published 95% confidence interval to ` +
        `combine and the term was left out of the Eq 3.1 combination. The combined ` +
        `uncertainty is therefore a lower bound. It was not treated as exact — it was ` +
        `treated as unquantified, which is a different and more honest thing.`,
    },
  ];

  return {
    outcome: 'mass',
    massKg,
    audit: massAudit(
      unit,
      input.quantity,
      [volumeStep, densityStep, applyStep],
      skipped,
      `Entered as a volume. Turning a volume into a mass needs a density, and the parameter ` +
        `library publishes none for ${fuel.label}, so the figure you supplied was used. The net ` +
        `calorific value then converts that mass to energy in the next step.`,
    ),
  };
}

/** The density the user gave, or a refusal that says where to find one. */
function requireDensity(
  fuel: Fuel,
  unit: Unit,
  density: UserDensity | undefined,
  library: ParameterLibrary,
): UserDensity {
  if (density) {
    return density;
  }

  const record = library.densities.find((candidate) => candidate.fuel === fuel.id);

  throw new EngineError(
    'missing_density',
    `A volume of ${fuel.label} cannot be converted to a mass without a density, and none is ` +
      `published for it: ${record ? `the record ${record.id} is deliberately empty` : 'the ' +
        'library carries no density record for this fuel at all'}, because no citable source ` +
      `has been found. Supply one and it will be used exactly as given. A supplier's spec ` +
      `sheet, the national fuel standard, or the bill itself will usually state it. The engine ` +
      `will not substitute a value for a similar fuel or estimate one from general knowledge.` +
      (unit.id === 'ft3'
        ? ` For cubic feet, use a density quoted on the same temperature and pressure basis as ` +
          `your meter, because the engine does not convert between reference conditions.`
        : ''),
  );
}

/**
 * Energy in, energy out — and the net calorific value never enters it.
 *
 * The Guidelines' emission factors are per terajoule of fuel energy, so a user
 * who already knows the energy has the quantity Eq 2.1 wants. Converting it to
 * a mass first and back again through a calorific value would add the widest
 * term in the whole calculation for no reason.
 *
 * The one question that must be asked is which heating value the figure is on.
 * The Guidelines work in net; bills are sometimes gross. Guessing would be a
 * silent 5 or 10 percent error, so the caller must say.
 */
function energyToTerajoules(
  fuel: Fuel,
  unit: Unit,
  input: FuelQuantity,
  energyStep: ConversionStep,
  library: ParameterLibrary,
): ConvertedQuantity {
  const basis = input.calorificBasis;

  if (basis === undefined) {
    throw new EngineError(
      'missing_calorific_basis',
      `An energy figure has to say whether it is a net (lower) or a gross (higher) heating ` +
        `value before it can be used. The 2006 IPCC Guidelines work in net calorific values, ` +
        `and a gross figure is several percent larger for the same fuel, so treating one as ` +
        `the other would be a silent error rather than a visible gap. Bills and meters state ` +
        `which they use, sometimes as "net"/"gross" and sometimes as "lower"/"higher" ` +
        `heating value.`,
    );
  }

  const steps = [energyStep];
  const skipped: SkippedUncertaintyTerm[] = [];

  if (basis === 'gross') {
    const conversion = requireCalorificBasisConversion(fuel, library);
    steps.push(grossToNetStep(conversion, energyStep.toValue, library));
    skipped.push({
      parameterId: conversion.id,
      role: 'calorific_basis',
      label: conversion.label,
      reason: 'approximation_not_quantified',
      note:
        `The gross figure was converted to a net one with the rule of thumb in Vol 2 Ch 1 — ` +
        `about ${formatNumber(conversion.reduction_percent)} percent — and the Guidelines do ` +
        `not say how far off that rule can be, so no term for it could be added to the Eq 3.1 ` +
        `combination. The combined uncertainty is a lower bound. Box 1.1 of the same chapter ` +
        `gives an exact conversion, but it needs the fuel's hydrogen and moisture content.`,
    });
  }

  const last = steps[steps.length - 1];

  return {
    outcome: 'energy',
    energyTJ: last.toValue,
    audit: {
      unitId: unit.id,
      unitLabel: unit.label,
      unitSymbol: unit.symbol,
      measures: unit.measures,
      quantity: input.quantity,
      steps,
      outcome: 'energy',
      resultValue: last.toValue,
      resultUnit: CANONICAL_UNITS.energy,
      usesCalorificValue: false,
      calorificBasis: basis,
      skippedUncertainty: skipped,
      note:
        `Entered as energy, so the net calorific value was not used at all — Eq 2.1 applies ` +
        `to your figure directly. This path carries less uncertainty than entering a mass of ` +
        `the same fuel, because the calorific value, usually the widest term in the ` +
        `combination, never enters it.` +
        (basis === 'gross'
          ? ` The figure was given as a gross heating value, so an approximate correction was ` +
            `applied to bring it to the net basis the Guidelines work in.`
          : ` The figure was given as a net heating value, which is the basis the Guidelines ` +
            `work in, so nothing was corrected.`),
    },
  };
}

/** The rule of thumb for this fuel's family, or a refusal to borrow another's. */
function requireCalorificBasisConversion(
  fuel: Fuel,
  library: ParameterLibrary,
): CalorificBasisConversion {
  const family = fuel.calorific_basis_family;

  if (family === undefined) {
    throw new EngineError(
      'missing_calorific_basis_conversion',
      `No gross-to-net calorific conversion is published for ${fuel.label}. Vol 2 Ch 1 gives a ` +
        `rule of thumb for coal and oil and another for natural and manufactured gas, but ` +
        `neither covers solid biomass, where the difference is driven by moisture content and ` +
        `is both larger and more variable. The engine will not borrow another fuel family's ` +
        `figure. Enter a net (lower) heating value, or enter the mass instead.`,
    );
  }

  const conversion = library.calorific_basis_conversions.find(
    (candidate) => candidate.fuel_family === family,
  );

  if (!conversion) {
    throw new EngineError(
      'missing_calorific_basis_conversion',
      `${fuel.label} is in the calorific basis family "${family}", but the parameter library ` +
        `publishes no gross-to-net conversion for that family. The engine will not estimate one.`,
    );
  }

  return conversion;
}

/**
 * Gross to net, by the Guidelines' own rule of thumb.
 *
 * The library stores what Vol 2 Ch 1 actually says — "about 5 percent below" —
 * and the multiplier is worked out here, so there is one number to be wrong
 * rather than two that can quietly disagree.
 */
function grossToNetStep(
  conversion: CalorificBasisConversion,
  grossTJ: number,
  library: ParameterLibrary,
): ConversionStep {
  const multiplier = 1 - conversion.reduction_percent / 100;
  const netTJ = grossTJ * multiplier;

  return {
    id: conversion.id,
    label: conversion.label,
    provenance: conversion.provenance,
    factor: multiplier,
    factorUnit: 'net TJ per gross TJ',
    source: conversion.source,
    verified: conversion.verified,
    fromValue: grossTJ,
    fromUnit: `${CANONICAL_UNITS.energy} (gross)`,
    toValue: netTJ,
    toUnit: `${CANONICAL_UNITS.energy} (net)`,
    workings:
      `${formatNumber(grossTJ)} TJ gross x (1 - ${formatNumber(conversion.reduction_percent)}/100) ` +
      `= ${formatNumber(grossTJ)} TJ x ${formatNumber(multiplier)} = ${formatNumber(netTJ)} TJ net`,
    approximate: true,
    note: `${conversion.note} ${library.calorific_basis_note}`,
  };
}

/** The shared shape of both routes that end in a mass. */
function massAudit(
  unit: Unit,
  quantity: number,
  steps: ConversionStep[],
  skipped: SkippedUncertaintyTerm[],
  note: string,
): ConversionAudit {
  const last = steps[steps.length - 1];

  return {
    unitId: unit.id,
    unitLabel: unit.label,
    unitSymbol: unit.symbol,
    measures: unit.measures,
    quantity,
    steps,
    outcome: 'mass',
    resultValue: last.toValue,
    resultUnit: CANONICAL_UNITS.mass,
    usesCalorificValue: true,
    calorificBasis: null,
    skippedUncertainty: skipped,
    note,
  };
}

function massNote(unit: Unit): string {
  return unit.id === CANONICAL_UNITS.mass
    ? `Entered in kilograms, which is the unit the engine works in, so no conversion was ` +
        `applied. The net calorific value converts it to energy in the next step.`
    : `Entered as a mass. The only conversion applied was the defined one from ${unit.label.toLowerCase()} ` +
        `to kilograms, which adds no uncertainty. The net calorific value converts it to ` +
        `energy in the next step.`;
}
