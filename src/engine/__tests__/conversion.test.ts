/**
 * Fixture tests for the conversion layer.
 *
 * Every expected value below is worked out by hand from a defined conversion or
 * a cited IPCC figure, with the derivation written out. Nothing here is a
 * snapshot of what the code happened to produce.
 *
 * Shared figures, so the derivations below stay short:
 *
 *   1 lb  = 0.45359237 kg          (international yard and pound, 1959)
 *   1 ft  = 0.3048 m               (same agreement), so 1 ft^3 = 0.3048^3 m^3
 *                                  = 0.028316846592 m^3
 *   1 L   = 10^-3 m^3              (definition of the litre)
 *   1 kWh = 3.6 MJ                 (1 W = 1 J/s, 1 h = 3600 s)
 *   1 TJ  = 10^6 MJ = 10^3 GJ      (SI prefixes)
 *   1 kg  = 10^-6 Gg               (SI prefixes)
 *
 * NCVs (Vol 2 Ch 1, Table 1.2): LPG 47.3, kerosene 43.8, natural gas 48.0 TJ/Gg.
 * EFs  (Vol 2 Ch 2, Table 2.5):  LPG CO2 63 100, kerosene CO2 71 900,
 *                                natural gas CO2 56 100 kg/TJ.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import type { ParameterLibrary } from '../../data/types';
import { calculateFuelCombustion, calculateFuelCombustionFromQuantity } from '../combustion';
import { convertQuantity } from '../conversion';
import { EngineError } from '../errors';
import type { GasEmission } from '../types';

function gas(emissions: GasEmission[], name: string): GasEmission {
  const found = emissions.find((emission) => emission.gas === name);
  if (!found) {
    throw new Error(`Expected a ${name} figure, got: ${emissions.map((e) => e.gas).join(', ')}`);
  }
  return found;
}

const LPG = 'liquefied_petroleum_gases';
const RESIDENTIAL = '1A4b';

describe('mass units', () => {
  it('converts grams to kilograms', () => {
    // 2500 g x 0.001 kg/g = 2.5 kg
    const converted = convertQuantity('charcoal', { quantity: 2500, unit: 'g' });
    expect(converted.outcome).toBe('mass');
    expect(converted.outcome === 'mass' && converted.massKg).toBe(2.5);
  });

  it('leaves kilograms alone, and says so rather than showing no step at all', () => {
    // 150 kg x 1 kg/kg = 150 kg
    const converted = convertQuantity(LPG, { quantity: 150, unit: 'kg' });
    expect(converted.outcome === 'mass' && converted.massKg).toBe(150);
    expect(converted.audit.steps).toHaveLength(1);
    expect(converted.audit.steps[0].factor).toBe(1);
  });

  it('converts tonnes to kilograms', () => {
    // 2 t x 1000 kg/t = 2000 kg
    const converted = convertQuantity('charcoal', { quantity: 2, unit: 't' });
    expect(converted.outcome === 'mass' && converted.massKg).toBe(2000);
  });

  it('converts pounds to kilograms by the 1959 definition, not a rounded one', () => {
    // 100 lb x 0.45359237 kg/lb = 45.359237 kg, exactly.
    const converted = convertQuantity(LPG, { quantity: 100, unit: 'lb' });
    expect(converted.outcome === 'mass' && converted.massKg).toBeCloseTo(45.359237, 12);
  });

  it('carries a pound conversion all the way through Eq 2.1', () => {
    // 100 lb LPG, residential.
    //
    //   mass   = 100 x 0.45359237      = 45.359237 kg
    //          = 45.359237e-6 Gg       = 4.5359237e-5 Gg
    //   energy = 4.5359237e-5 x 47.3   = 0.0021454919101 TJ
    //   CO2    = 0.0021454919101 x 63100
    //          = 135.38053952731 kg
    const result = calculateFuelCombustionFromQuantity(
      LPG,
      { quantity: 100, unit: 'lb' },
      RESIDENTIAL,
    );

    expect(result.massKg).toBeCloseTo(45.359237, 12);
    expect(result.energyTJ).toBeCloseTo(0.0021454919101, 14);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(135.38053952731, 8);
  });

  it('agrees with the kilogram entry point when the units agree', () => {
    // 2 t and 2000 kg are the same quantity, so they must be the same result
    // exactly — not close, identical — or the conversion layer has introduced
    // arithmetic of its own.
    const tonnes = calculateFuelCombustionFromQuantity(
      'charcoal',
      { quantity: 2, unit: 't' },
      RESIDENTIAL,
    );
    const kilograms = calculateFuelCombustion('charcoal', 2000, RESIDENTIAL);

    expect(tonnes.energyTJ).toBe(kilograms.energyTJ);
    expect(gas(tonnes.totalContributing, 'CH4').kg).toBe(
      gas(kilograms.totalContributing, 'CH4').kg,
    );
  });
});

describe('volume units, through a density the user supplies', () => {
  it('converts litres to a mass with a density in kg per litre', () => {
    // 20 L kerosene at 0.8 kg/L.
    //
    //   volume  = 20 x 0.001           = 0.02 m^3
    //   density = 0.8 x 1000           = 800 kg/m^3
    //   mass    = 0.02 x 800           = 16 kg
    const converted = convertQuantity('other_kerosene', {
      quantity: 20,
      unit: 'litre',
      density: { value: 0.8, unit: 'kg_per_litre' },
    });

    expect(converted.outcome === 'mass' && converted.massKg).toBeCloseTo(16, 12);
    expect(converted.audit.steps.map((step) => step.provenance)).toEqual([
      'exact',
      'exact',
      'user_provided',
    ]);
  });

  it('carries that mass through Eq 2.1', () => {
    // 16 kg kerosene, residential.
    //
    //   energy = 16e-6 x 43.8          = 0.0007008 TJ
    //   CO2    = 0.0007008 x 71900     = 50.38752 kg
    const result = calculateFuelCombustionFromQuantity(
      'other_kerosene',
      { quantity: 20, unit: 'litre', density: { value: 0.8, unit: 'kg_per_litre' } },
      RESIDENTIAL,
    );

    expect(result.energyTJ).toBeCloseTo(0.0007008, 14);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(50.38752, 10);
  });

  it('converts cubic metres with a density in kg per cubic metre', () => {
    // 100 m^3 natural gas at 0.75 kg/m^3.
    //
    //   volume = 100 x 1               = 100 m^3
    //   mass   = 100 x 0.75            = 75 kg
    const converted = convertQuantity('natural_gas', {
      quantity: 100,
      unit: 'm3',
      density: { value: 0.75, unit: 'kg_per_m3' },
    });

    expect(converted.outcome === 'mass' && converted.massKg).toBeCloseTo(75, 12);
  });

  it('converts cubic feet by the exact geometric definition', () => {
    // 1000 ft^3 natural gas at 0.75 kg/m^3.
    //
    //   volume = 1000 x 0.028316846592 = 28.316846592 m^3
    //   mass   = 28.316846592 x 0.75   = 21.237634944 kg
    //   energy = 21.237634944e-6 x 48.0
    //                                  = 0.001019406477312 TJ
    //   CO2    = 0.001019406477312 x 56100
    //                                  = 57.18870337720 kg
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'ft3', density: { value: 0.75, unit: 'kg_per_m3' } },
      RESIDENTIAL,
    );

    expect(result.massKg).toBeCloseTo(21.237634944, 10);
    expect(result.energyTJ).toBeCloseTo(0.001019406477312, 15);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(57.1887033772, 8);
  });

  it('states the reference-conditions assumption on the cubic-foot step', () => {
    // The volume conversion is exact; the reference conditions are not carried
    // by it at all. Saying so is the whole point of the note, so its absence
    // would be a real regression rather than a copy change.
    const converted = convertQuantity('natural_gas', {
      quantity: 1000,
      unit: 'ft3',
      density: { value: 0.75, unit: 'kg_per_m3' },
    });

    const step = converted.audit.steps[0];
    expect(step.id).toBe('ft3');
    expect(step.note).toMatch(/reference conditions/);
    expect(step.note).toMatch(/assumes none on your behalf/);
  });

  it('treats the density as exact but records the uncertainty it could not evaluate', () => {
    const result = calculateFuelCombustionFromQuantity(
      'other_kerosene',
      { quantity: 20, unit: 'litre', density: { value: 0.8, unit: 'kg_per_litre' } },
      RESIDENTIAL,
    );
    const co2 = gas(result.totalContributing, 'CO2');

    const skipped = co2.uncertainty.skipped.find((term) => term.parameterId === 'user_density');
    expect(skipped?.reason).toBe('user_provided');
    expect(skipped?.role).toBe('density');
    expect(co2.uncertainty.incomplete).toBe(true);

    // Skipped, not silently included: the density must not appear as a term.
    expect(co2.uncertainty.terms.map((term) => term.role)).not.toContain('density');
  });

  it('scales in exact proportion to the density given', () => {
    // The density is applied as a plain multiplier, so doubling it must double
    // every gas. This is what makes the "everything is proportional to your
    // figure" warning in the UI a true statement rather than a hedge.
    const single = calculateFuelCombustionFromQuantity(
      'other_kerosene',
      { quantity: 20, unit: 'litre', density: { value: 0.8, unit: 'kg_per_litre' } },
      RESIDENTIAL,
    );
    const double = calculateFuelCombustionFromQuantity(
      'other_kerosene',
      { quantity: 20, unit: 'litre', density: { value: 1.6, unit: 'kg_per_litre' } },
      RESIDENTIAL,
    );

    expect(gas(double.totalContributing, 'CO2').kg).toBeCloseTo(
      gas(single.totalContributing, 'CO2').kg * 2,
      10,
    );
  });

  it('refuses a volume with no density rather than substituting one', () => {
    // CLAUDE.md rule 7. Every density in the library is null and unsourced, and
    // this is the moment that either respects that or quietly undoes it.
    try {
      convertQuantity('other_kerosene', { quantity: 20, unit: 'litre' });
      expect.unreachable('expected a missing-density error');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      const engineError = error as EngineError;
      expect(engineError.code).toBe('missing_density');
      expect(engineError.message).toContain('density_other_kerosene');
      expect(engineError.message).toContain('spec sheet');
      expect(engineError.message).toContain('will not substitute');
    }
  });

  it('points at the reference conditions when refusing a cubic-foot input', () => {
    try {
      convertQuantity('natural_gas', { quantity: 1000, unit: 'ft3' });
      expect.unreachable('expected a missing-density error');
    } catch (error) {
      expect((error as EngineError).message).toMatch(/same temperature and pressure basis/);
    }
  });

  it('rejects a density of zero, which would weigh any volume as nothing', () => {
    try {
      convertQuantity('other_kerosene', {
        quantity: 20,
        unit: 'litre',
        density: { value: 0, unit: 'kg_per_litre' },
      });
      expect.unreachable('expected an invalid-density error');
    } catch (error) {
      expect((error as EngineError).code).toBe('invalid_density');
    }
  });

  it('rejects a density given in a unit that is not a density', () => {
    try {
      convertQuantity('other_kerosene', {
        quantity: 20,
        unit: 'litre',
        density: { value: 0.8, unit: 'kg' },
      });
      expect.unreachable('expected an unknown-unit error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_unit');
    }
  });
});

describe('energy units bypass the calorific value', () => {
  it('converts kilowatt-hours straight to terajoules', () => {
    // 1000 kWh x 3.6e-6 TJ/kWh = 0.0036 TJ
    const converted = convertQuantity('natural_gas', {
      quantity: 1000,
      unit: 'kWh',
      calorificBasis: 'net',
    });

    expect(converted.outcome).toBe('energy');
    expect(converted.outcome === 'energy' && converted.energyTJ).toBeCloseTo(0.0036, 14);
    expect(converted.audit.usesCalorificValue).toBe(false);
  });

  it('converts megajoules and gigajoules to the same terajoules', () => {
    // 7095 MJ x 1e-6 = 0.007095 TJ;  7.095 GJ x 0.001 = 0.007095 TJ
    const megajoules = convertQuantity(LPG, {
      quantity: 7095,
      unit: 'MJ',
      calorificBasis: 'net',
    });
    const gigajoules = convertQuantity(LPG, {
      quantity: 7.095,
      unit: 'GJ',
      calorificBasis: 'net',
    });

    expect(megajoules.outcome === 'energy' && megajoules.energyTJ).toBeCloseTo(0.007095, 15);
    expect(gigajoules.outcome === 'energy' && gigajoules.energyTJ).toBeCloseTo(0.007095, 15);
  });

  it('applies Eq 2.1 to the entered energy, with no mass anywhere in the result', () => {
    // 1000 kWh natural gas, residential, net.
    //
    //   energy = 1000 x 3.6e-6         = 0.0036 TJ
    //   CO2    = 0.0036 x 56100        = 201.96 kg
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'net' },
      RESIDENTIAL,
    );

    expect(result.energyTJ).toBeCloseTo(0.0036, 14);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(201.96, 10);

    // Not zero, not defaulted: absent. Nothing was ever weighed.
    expect(result.massKg).toBeNull();
    expect(result.audit.energyConversion).toBeNull();
  });

  it('leaves the calorific value out of the audit trail entirely, not merely unused', () => {
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'net' },
      RESIDENTIAL,
    );

    expect(result.audit.factors.map((factor) => factor.parameterId)).toEqual([
      'ef_1a4b_natural_gas_co2',
      'ef_1a4b_natural_gas_ch4',
      'ef_1a4b_natural_gas_n2o',
    ]);
    expect(result.audit.conversion.note).toContain('net calorific value was not used');
  });

  it('calculates a fuel that has no calorific value at all, because it needs none', () => {
    // Constructed against a library with the natural gas NCV removed. The mass
    // route would throw here; the energy route does not need the parameter, so
    // it must not fail for the want of it.
    const withoutNcv: ParameterLibrary = {
      ...parameters,
      net_calorific_values: parameters.net_calorific_values.filter(
        (ncv) => ncv.fuel !== 'natural_gas',
      ),
    };

    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'net' },
      RESIDENTIAL,
      {},
      withoutNcv,
    );
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(201.96, 10);

    expect(() =>
      calculateFuelCombustion('natural_gas', 75, RESIDENTIAL, {}, withoutNcv),
    ).toThrowError(/No net calorific value is published/);
  });

  it('refuses an energy figure that does not say whether it is net or gross', () => {
    try {
      convertQuantity('natural_gas', { quantity: 1000, unit: 'kWh' });
      expect.unreachable('expected a missing-basis error');
    } catch (error) {
      expect((error as EngineError).code).toBe('missing_calorific_basis');
      expect((error as EngineError).message).toContain('silent error');
    }
  });
});

describe('gross to net, by the rule of thumb in Vol 2 Ch 1', () => {
  it('takes 10 percent off a gas figure', () => {
    // 1000 kWh natural gas, gross.
    //
    //   gross  = 1000 x 3.6e-6         = 0.0036 TJ
    //   net    = 0.0036 x (1 - 10/100) = 0.0036 x 0.9 = 0.00324 TJ
    //   CO2    = 0.00324 x 56100       = 181.764 kg
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'gross' },
      RESIDENTIAL,
    );

    expect(result.energyTJ).toBeCloseTo(0.00324, 14);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(181.764, 10);
  });

  it('takes 5 percent off an oil-product figure', () => {
    // 7095 MJ LPG, gross. Table 1.1 classifies LPG as a liquid fuel, so the
    // coal-and-oil rule applies, not the gas one.
    //
    //   gross  = 7095e-6               = 0.007095 TJ
    //   net    = 0.007095 x 0.95       = 0.00674025 TJ
    //   CO2    = 0.00674025 x 63100    = 425.309775 kg
    const result = calculateFuelCombustionFromQuantity(
      LPG,
      { quantity: 7095, unit: 'MJ', calorificBasis: 'gross' },
      RESIDENTIAL,
    );

    expect(result.energyTJ).toBeCloseTo(0.00674025, 14);
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(425.309775, 9);
  });

  it('flags the step as approximate and records the term it could not quantify', () => {
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'gross' },
      RESIDENTIAL,
    );

    const step = result.audit.conversion.steps[1];
    expect(step.id).toBe('gcv_to_ncv_natural_and_manufactured_gas');
    expect(step.provenance).toBe('ipcc_approximate');
    expect(step.approximate).toBe(true);
    expect(step.note).toContain('Box 1.1');

    const co2 = gas(result.totalContributing, 'CO2');
    const skipped = co2.uncertainty.skipped.find(
      (term) => term.parameterId === 'gcv_to_ncv_natural_and_manufactured_gas',
    );
    expect(skipped?.reason).toBe('approximation_not_quantified');
    expect(co2.uncertainty.incomplete).toBe(true);
  });

  it('surfaces the approximation as a caveat beside the result, not only in the working', () => {
    const result = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'gross' },
      RESIDENTIAL,
    );

    expect(result.gaps.map((gap) => gap.kind)).toContain('approximate_conversion');
  });

  it('refuses to borrow a rule of thumb for solid biomass', () => {
    // The Guidelines publish the 5 percent rule for coal and oil and the 10
    // percent rule for gas. Neither covers charcoal, where moisture makes the
    // difference both larger and more variable. Applying either would be
    // inventing a factor (CLAUDE.md rule 7).
    try {
      convertQuantity('charcoal', { quantity: 100, unit: 'MJ', calorificBasis: 'gross' });
      expect.unreachable('expected a missing-conversion error');
    } catch (error) {
      expect((error as EngineError).code).toBe('missing_calorific_basis_conversion');
      expect((error as EngineError).message).toContain('will not borrow');
    }
  });

  it('still accepts a net figure for solid biomass, which needs no conversion', () => {
    // 100 MJ charcoal = 0.0001 TJ; CH4 EF 200 kg/TJ -> 0.02 kg
    const result = calculateFuelCombustionFromQuantity(
      'charcoal',
      { quantity: 100, unit: 'MJ', calorificBasis: 'net' },
      RESIDENTIAL,
    );
    expect(gas(result.totalContributing, 'CH4').kg).toBeCloseTo(0.02, 12);
  });
});

/**
 * The point of the energy route, stated as an assertion.
 *
 * It is not a convenience. Entering energy removes the net calorific value from
 * the Eq 3.1 combination, and for most fuels that is the widest term in it.
 */
describe('the energy route is tighter than the mass route for the same fuel', () => {
  // 150 kg LPG and 7095 MJ LPG are the same quantity of fuel:
  //
  //   150 kg = 1.5e-4 Gg;  1.5e-4 x 47.3 TJ/Gg = 0.007095 TJ
  //   7095 MJ x 1e-6                           = 0.007095 TJ
  //
  // so both produce 0.007095 x 63100 = 447.6945 kg CO2. What differs is what
  // had to be believed to get there.
  //
  //   U_ncv = ((52.2 - 44.8) / 2) / 47.3   x 100 = 7.822410148 %
  //   U_ef  = ((65600 - 61600) / 2) / 63100 x 100 = 3.169572108 %
  //
  //   by mass:   sqrt(7.822410148^2 + 3.169572108^2) = 8.440159232 %
  //   by energy: sqrt(3.169572108^2)                 = 3.169572108 %
  const byMass = calculateFuelCombustion(LPG, 150, RESIDENTIAL);
  const byEnergy = calculateFuelCombustionFromQuantity(
    LPG,
    { quantity: 7095, unit: 'MJ', calorificBasis: 'net' },
    RESIDENTIAL,
  );

  const massCo2 = gas(byMass.totalContributing, 'CO2');
  const energyCo2 = gas(byEnergy.totalContributing, 'CO2');

  it('produces the same emission figure both ways', () => {
    expect(byMass.energyTJ).toBeCloseTo(0.007095, 15);
    expect(byEnergy.energyTJ).toBeCloseTo(0.007095, 15);
    expect(energyCo2.kg).toBeCloseTo(massCo2.kg, 10);
    expect(energyCo2.kg).toBeCloseTo(447.6945, 10);
  });

  it('combines two terms by mass and one by energy', () => {
    expect(massCo2.uncertainty.terms.map((term) => term.parameterId)).toEqual([
      'ncv_lpg',
      'ef_1a4b_lpg_co2',
    ]);
    expect(energyCo2.uncertainty.terms.map((term) => term.parameterId)).toEqual([
      'ef_1a4b_lpg_co2',
    ]);
  });

  it('gives a smaller combined uncertainty by energy', () => {
    expect(massCo2.uncertainty.percent).toBeCloseTo(8.440159232, 8);
    expect(energyCo2.uncertainty.percent).toBeCloseTo(3.169572108, 8);
    expect(energyCo2.uncertainty.percent).toBeLessThan(massCo2.uncertainty.percent ?? 0);
  });

  it('is tighter because the calorific value is absent, not because it was assumed exact', () => {
    // The distinction that matters. A term dropped as "no uncertainty" would
    // give the same percentage and be a lie; the term is not there because the
    // parameter was never used, and the audit trail says which.
    expect(byEnergy.audit.conversion.usesCalorificValue).toBe(false);
    expect(energyCo2.uncertainty.skipped.map((term) => term.parameterId)).not.toContain('ncv_lpg');
    expect(energyCo2.audit.factors.map((factor) => factor.parameterId)).toEqual([
      'ef_1a4b_lpg_co2',
    ]);
  });

  it('holds for natural gas as well: 100 m3 against the 1000 kWh it represents', () => {
    // At 0.75 kg/m^3, 100 m^3 is 75 kg, which at 48.0 TJ/Gg is 0.0036 TJ —
    // the same energy as 1000 kWh. Same CO2, different confidence.
    //
    //   U_ncv = ((50.4 - 46.5) / 2) / 48.0    x 100 = 4.062500000 %
    //   U_ef  = ((58300 - 54300) / 2) / 56100 x 100 = 3.565062389 %
    //
    //   by volume: sqrt(4.0625^2 + 3.565062389^2) = 5.404958472 %
    //   by energy: sqrt(3.565062389^2)            = 3.565062389 %
    const byVolume = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 100, unit: 'm3', density: { value: 0.75, unit: 'kg_per_m3' } },
      RESIDENTIAL,
    );
    const byKilowattHours = calculateFuelCombustionFromQuantity(
      'natural_gas',
      { quantity: 1000, unit: 'kWh', calorificBasis: 'net' },
      RESIDENTIAL,
    );

    const volumeCo2 = gas(byVolume.totalContributing, 'CO2');
    const energyCo2Gas = gas(byKilowattHours.totalContributing, 'CO2');

    expect(volumeCo2.kg).toBeCloseTo(energyCo2Gas.kg, 10);
    expect(volumeCo2.uncertainty.percent).toBeCloseTo(5.404958472, 8);
    expect(energyCo2Gas.uncertainty.percent).toBeCloseTo(3.565062389, 8);

    // The volume route is worse twice over: a wider combination, and a density
    // term it could not evaluate at all.
    expect(volumeCo2.uncertainty.skipped.map((term) => term.reason)).toContain('user_provided');
  });
});

describe('every conversion step carries its factor, its class and its working', () => {
  // CLAUDE.md rule 1, applied to conversions. A step that showed a number
  // without saying where the number came from would be exactly the kind of
  // opaque arithmetic this product exists to replace.
  const cases = [
    { name: 'kilograms', fuel: LPG, input: { quantity: 150, unit: 'kg' } },
    { name: 'pounds', fuel: LPG, input: { quantity: 100, unit: 'lb' } },
    { name: 'grams', fuel: 'charcoal', input: { quantity: 2500, unit: 'g' } },
    { name: 'tonnes', fuel: 'charcoal', input: { quantity: 2, unit: 't' } },
    {
      name: 'litres',
      fuel: 'other_kerosene',
      input: { quantity: 20, unit: 'litre', density: { value: 0.8, unit: 'kg_per_litre' } },
    },
    {
      name: 'cubic metres',
      fuel: 'natural_gas',
      input: { quantity: 100, unit: 'm3', density: { value: 0.75, unit: 'kg_per_m3' } },
    },
    {
      name: 'cubic feet',
      fuel: 'natural_gas',
      input: { quantity: 1000, unit: 'ft3', density: { value: 0.75, unit: 'kg_per_m3' } },
    },
    {
      name: 'kilowatt-hours',
      fuel: 'natural_gas',
      input: { quantity: 1000, unit: 'kWh', calorificBasis: 'net' as const },
    },
    {
      name: 'megajoules',
      fuel: LPG,
      input: { quantity: 7095, unit: 'MJ', calorificBasis: 'net' as const },
    },
    {
      name: 'gigajoules',
      fuel: LPG,
      input: { quantity: 7.095, unit: 'GJ', calorificBasis: 'net' as const },
    },
    {
      name: 'gross kilowatt-hours',
      fuel: 'natural_gas',
      input: { quantity: 1000, unit: 'kWh', calorificBasis: 'gross' as const },
    },
  ];

  it.each(cases)('$name', ({ fuel, input }) => {
    const converted = convertQuantity(fuel, input);

    expect(converted.audit.steps.length).toBeGreaterThan(0);
    for (const step of converted.audit.steps) {
      expect(step.id).toBeTruthy();
      expect(step.label).toBeTruthy();
      expect(['exact', 'ipcc_approximate', 'user_provided']).toContain(step.provenance);
      expect(Number.isFinite(step.factor)).toBe(true);
      expect(step.factorUnit).toBeTruthy();
      expect(step.source).toBeTruthy();
      expect(step.workings).toContain('=');
      // The working must end in the number the step actually produced, or it
      // is decoration rather than a check.
      expect(step.workings).toContain(String(Number(step.toValue.toPrecision(12))));
    }

    // Only the gross-to-net rule of thumb may claim to be approximate.
    for (const step of converted.audit.steps) {
      expect(step.approximate).toBe(step.provenance === 'ipcc_approximate');
    }
  });
});

describe('input validation', () => {
  it('rejects a negative quantity whatever the unit', () => {
    expect(() => convertQuantity(LPG, { quantity: -1, unit: 'lb' })).toThrowError(/non-negative/);
  });

  it('rejects a quantity that is not a number', () => {
    expect(() => convertQuantity(LPG, { quantity: Number.NaN, unit: 'kg' })).toThrowError(
      EngineError,
    );
  });

  it('rejects an unknown unit and lists the ones that exist', () => {
    try {
      convertQuantity(LPG, { quantity: 1, unit: 'gallon' });
      expect.unreachable('expected an unknown-unit error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_unit');
      expect((error as EngineError).message).toContain('litre');
    }
  });

  it('rejects a density unit used as a quantity', () => {
    // "5 kilograms per litre of kerosene" is not an amount of fuel.
    try {
      convertQuantity('other_kerosene', { quantity: 5, unit: 'kg_per_litre' });
      expect.unreachable('expected an unknown-unit error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_unit');
      expect((error as EngineError).message).toContain('not a quantity of fuel');
    }
  });

  it('rejects an unknown fuel before doing any arithmetic', () => {
    expect(() => convertQuantity('bituminous_coal', { quantity: 1, unit: 'kg' })).toThrowError(
      /No fuel with id/,
    );
  });

  it('offers neither gallons nor therms', () => {
    // Deliberate: the US and imperial gallon differ by about 20 percent, and
    // the therm has more than one definition. A user entering either would be
    // entering a number that means something other than what they think.
    const ids = parameters.units.map((unit) => unit.id);
    expect(ids).not.toContain('gallon');
    expect(ids).not.toContain('therm');
  });
});
