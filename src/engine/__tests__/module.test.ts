/**
 * The calculation-module interface.
 *
 * Every IPCC category will be reached through this interface, so it has to hold
 * two lines at once. It must let a module say honestly what it needs — including
 * needs no module can satisfy yet, like the year-by-year waste history First
 * Order Decay integrates — and it must refuse to produce a number when it was
 * handed something it cannot actually use. An interface that quietly dropped an
 * unusable input would return a result that looked like an answer.
 *
 * The migration of fuel combustion into the interface is also pinned here: going
 * through the module must produce exactly what calling the function produces.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import type { ParameterLibrary } from '../../data/types';
import {
  calculateFuelCombustion,
  createFuelCombustionModule,
  FUEL_COMBUSTION_INPUTS,
  FUEL_COMBUSTION_MODULE_ID,
} from '../combustion';
import { EngineError } from '../errors';
import {
  assertShapeImplemented,
  IMPLEMENTED_INPUT_SHAPES,
  matrix,
  optionalInputsAt,
  requiredInputsAt,
  scalar,
  selection,
  timeSeries,
  validateInputs,
  type InputSchema,
  type ModuleInputs,
} from '../module';

const residential = createFuelCombustionModule('1A4b');
const roadTransport = createFuelCombustionModule('1A3b');

const names = (schema: InputSchema): string[] => schema.inputs.map((input) => input.name);

function declaration(schema: InputSchema, name: string) {
  const found = schema.inputs.find((input) => input.name === name);
  if (!found) {
    throw new Error(`no input named ${name}; declared: ${names(schema).join(', ')}`);
  }
  return found;
}

describe('a module says what it is', () => {
  it('carries a method id, a label and the one category it calculates', () => {
    expect(residential.id).toBe(FUEL_COMBUSTION_MODULE_ID);
    expect(residential.categoryCode).toBe('1A4b');
    expect(roadTransport.categoryCode).toBe('1A3b');
    expect(residential.label).toContain('Eq 2.1');
  });

  it('is one method with an instance per category, not one instance for both', () => {
    expect(residential.id).toBe(roadTransport.id);
    expect(residential.categoryCode).not.toBe(roadTransport.categoryCode);
  });
});

describe('declareInputs describes what the category needs', () => {
  const schema = residential.declareInputs();

  it('names the category it is describing', () => {
    expect(schema.categoryCode).toBe('1A4b');
  });

  it('declares a fuel, a mass and an optional uncertainty', () => {
    expect(names(schema)).toEqual([
      FUEL_COMBUSTION_INPUTS.fuel,
      FUEL_COMBUSTION_INPUTS.mass,
      FUEL_COMBUSTION_INPUTS.activityDataUncertaintyPercent,
    ]);
  });

  it('gives every input a shape and a unit, or says it has none', () => {
    expect(declaration(schema, 'mass').shape).toBe('scalar');
    expect(declaration(schema, 'mass').unit).toBe('kg');
    expect(declaration(schema, 'fuel').shape).toBe('selection');
    expect(declaration(schema, 'fuel').unit).toBeNull();
    expect(declaration(schema, 'activityDataUncertaintyPercent').unit).toBe('%');
  });

  it('says which inputs are required at which tier', () => {
    expect(requiredInputsAt(schema, 1).map((input) => input.name)).toEqual(['fuel', 'mass']);
    expect(optionalInputsAt(schema, 1).map((input) => input.name)).toEqual([
      'activityDataUncertaintyPercent',
    ]);
  });

  it('offers only the fuels the library can actually calculate here', () => {
    // Petrol has no residential factor set, so offering it would offer a
    // calculation that throws.
    const offered = declaration(schema, 'fuel').options?.map((option) => option.value);
    expect(offered).toEqual([
      'liquefied_petroleum_gases',
      'charcoal',
      'wood_wood_waste',
      'other_kerosene',
      'natural_gas',
    ]);
  });

  it('labels each option with the library’s own wording', () => {
    const charcoal = declaration(schema, 'fuel').options?.find(
      (option) => option.value === 'charcoal',
    );
    expect(charcoal?.label).toBe('Charcoal');
  });

  it('declares no vehicle technology where the Guidelines publish none', () => {
    expect(names(schema)).not.toContain(FUEL_COMBUSTION_INPUTS.vehicleTechnology);
  });
});

describe('declareInputs differs by category, because the data does', () => {
  const schema = roadTransport.declareInputs();

  it('offers the road-transport fuels', () => {
    expect(declaration(schema, 'fuel').options?.map((option) => option.value)).toEqual([
      'liquefied_petroleum_gases',
      'motor_gasoline',
      'gas_diesel_oil',
    ]);
  });

  it('declares a vehicle technology, required only at Tier 3', () => {
    const technology = declaration(schema, FUEL_COMBUSTION_INPUTS.vehicleTechnology);
    expect(technology.shape).toBe('selection');
    expect(technology.availableAtTiers).toEqual([3]);
    expect(technology.requiredAtTiers).toEqual([3]);
  });

  it('lists the technologies the library publishes, with their labels', () => {
    const options = declaration(schema, FUEL_COMBUSTION_INPUTS.vehicleTechnology).options ?? [];
    expect(options.map((option) => option.value)).toEqual([
      'uncontrolled',
      'oxidation_catalyst',
      'ldv_1995_or_later',
    ]);
    for (const option of options) {
      expect(option.label).toBeTruthy();
    }
  });

  it('requires the technology at Tier 3 and refuses it at Tier 1', () => {
    expect(requiredInputsAt(schema, 3).map((input) => input.name)).toContain('vehicleTechnology');
    expect(requiredInputsAt(schema, 1).map((input) => input.name)).not.toContain(
      'vehicleTechnology',
    );
    expect(optionalInputsAt(schema, 1).map((input) => input.name)).not.toContain(
      'vehicleTechnology',
    );
  });
});

describe('availableTiers reports data specificity, not effort', () => {
  it('offers only Tier 1 where the library publishes only default factors', () => {
    expect(residential.availableTiers().map((entry) => entry.tier)).toEqual([1]);
  });

  it('offers Tier 1 and Tier 3 in road transport, where Table 3.2.2 disaggregates', () => {
    expect(roadTransport.availableTiers().map((entry) => entry.tier)).toEqual([1, 3]);
  });

  it('says what each tier requires', () => {
    const [tier1, tier3] = roadTransport.availableTiers();
    expect(tier1.requires).toContain('default factors');
    expect(tier1.requiredInputs).toEqual(['fuel', 'mass']);
    expect(tier3.requires).toContain('Table 3.2.2');
    expect(tier3.requiredInputs).toEqual(['fuel', 'mass', 'vehicleTechnology']);
  });

  it('is derived from the library, so removing the Tier 3 factors removes Tier 3', () => {
    // Tiers are a fact about the data the module has, not a claim it makes.
    const withoutTechnologyFactors: ParameterLibrary = {
      ...parameters,
      emission_factors: parameters.emission_factors.filter(
        (factor) => factor.vehicle_technology === undefined,
      ),
    };
    expect(() =>
      roadTransport.calculate(
        {
          fuel: selection('gas_diesel_oil'),
          mass: scalar(10),
          vehicleTechnology: selection('uncontrolled'),
        },
        3,
        { library: withoutTechnologyFactors },
      ),
    ).toThrowError(/cannot be calculated at Tier 3/);
  });
});

describe('calculate produces exactly what the function produced', () => {
  // The migration test. The reference fixture from CLAUDE.md, routed through the
  // module interface, must be indistinguishable from the direct call.
  it('matches the direct call for the reference fixture', () => {
    const throughModule = residential.calculate(
      { fuel: selection('liquefied_petroleum_gases'), mass: scalar(150) },
      1,
    );
    expect(throughModule).toEqual(
      calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b'),
    );
  });

  it('still produces 447.6945 kg CO2 from 150 kg of LPG', () => {
    const result = residential.calculate(
      { fuel: selection('liquefied_petroleum_gases'), mass: scalar(150) },
      1,
    );
    const co2 = result.totalContributing.find((emission) => emission.gas === 'CO2');
    expect(result.energyTJ).toBeCloseTo(0.007095, 12);
    expect(co2?.kg).toBeCloseTo(447.6945, 6);
  });

  it('keeps biomass CO2 out of the total when routed through the interface', () => {
    const result = residential.calculate({ fuel: selection('charcoal'), mass: scalar(50) }, 1);
    expect(result.memoItems.map((emission) => emission.gas)).toEqual(['CO2']);
    expect(result.totalContributing.map((emission) => emission.gas)).toEqual(['CH4', 'N2O']);
  });

  it('passes a Tier 3 technology selection through', () => {
    const throughModule = roadTransport.calculate(
      {
        fuel: selection('motor_gasoline'),
        mass: scalar(10),
        vehicleTechnology: selection('uncontrolled'),
      },
      3,
    );
    expect(throughModule).toEqual(
      calculateFuelCombustion('motor_gasoline', 10, '1A3b', {
        vehicleTechnology: 'uncontrolled',
      }),
    );
    expect(throughModule.totalContributing.find((emission) => emission.gas === 'CH4')?.tier).toBe(3);
  });

  it('passes an optional uncertainty through, and omits it when absent', () => {
    const withUncertainty = residential.calculate(
      {
        fuel: selection('charcoal'),
        mass: scalar(50),
        activityDataUncertaintyPercent: scalar(10),
      },
      1,
    );
    expect(withUncertainty.audit.inputs.activityDataUncertaintyPercent).toBe(10);

    const without = residential.calculate({ fuel: selection('charcoal'), mass: scalar(50) }, 1);
    expect(without.audit.inputs.activityDataUncertaintyPercent).toBeNull();
  });

  it('reads parameters from an alternative library when asked', () => {
    const withoutCharcoalNcv: ParameterLibrary = {
      ...parameters,
      net_calorific_values: parameters.net_calorific_values.filter(
        (ncv) => ncv.fuel !== 'charcoal',
      ),
    };
    expect(() =>
      residential.calculate({ fuel: selection('charcoal'), mass: scalar(50) }, 1, {
        library: withoutCharcoalNcv,
      }),
    ).toThrowError(/no net calorific value|No net calorific value/i);
  });

  it('still refuses to choose a technology on the caller’s behalf', () => {
    try {
      roadTransport.calculate({ fuel: selection('motor_gasoline'), mass: scalar(10) }, 1);
      expect.unreachable('expected an ambiguous-factor error');
    } catch (error) {
      expect((error as EngineError).code).toBe('ambiguous_emission_factor');
    }
  });
});

describe('calculate refuses what it cannot honestly use', () => {
  const lpg: ModuleInputs = {
    fuel: selection('liquefied_petroleum_gases'),
    mass: scalar(150),
  };

  it('rejects a tier the category does not support', () => {
    try {
      residential.calculate(lpg, 2, {});
      expect.unreachable('expected an unsupported-tier error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unsupported_tier');
      expect((error as EngineError).message).toContain('Tier 1');
    }
  });

  it('rejects an input it never declared', () => {
    try {
      residential.calculate({ ...lpg, distanceDriven: scalar(100) }, 1);
      expect.unreachable('expected an unknown-input error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_input');
      expect((error as EngineError).message).toContain('distanceDriven');
    }
  });

  it('rejects a missing required input rather than defaulting it', () => {
    try {
      residential.calculate({ fuel: selection('charcoal') }, 1);
      expect.unreachable('expected a missing-input error');
    } catch (error) {
      expect((error as EngineError).code).toBe('missing_required_input');
      expect((error as EngineError).message).toContain('mass');
    }
  });

  it('rejects a value of the wrong shape rather than coercing it', () => {
    try {
      residential.calculate({ fuel: selection('charcoal'), mass: selection('50') }, 1);
      expect.unreachable('expected a wrong-shape error');
    } catch (error) {
      expect((error as EngineError).code).toBe('wrong_input_shape');
      expect((error as EngineError).message).toContain('mass');
    }
  });

  it('rejects a Tier 3 input supplied at Tier 1', () => {
    // Applying a technology-disaggregated factor to a result labelled Tier 1
    // would misreport data specificity as a UI convenience.
    try {
      roadTransport.calculate(
        {
          fuel: selection('gas_diesel_oil'),
          mass: scalar(10),
          vehicleTechnology: selection('uncontrolled'),
        },
        1,
      );
      expect.unreachable('expected a wrong-tier error');
    } catch (error) {
      expect((error as EngineError).code).toBe('input_not_available_at_tier');
      expect((error as EngineError).message).toContain('Tier 3');
    }
  });

  it('rejects a required input that is missing at Tier 3', () => {
    try {
      roadTransport.calculate({ fuel: selection('motor_gasoline'), mass: scalar(10) }, 3);
      expect.unreachable('expected a missing-input error');
    } catch (error) {
      expect((error as EngineError).code).toBe('missing_required_input');
      expect((error as EngineError).message).toContain('vehicleTechnology');
    }
  });
});

describe('input shapes that exist but are not implemented', () => {
  // Waste First Order Decay needs a year-indexed history; AFOLU needs a land
  // representation matrix. Both shapes exist in the type system so those methods
  // can be declared honestly when they arrive. Neither may be calculated with.

  it('implements scalar and selection, and nothing else yet', () => {
    expect([...IMPLEMENTED_INPUT_SHAPES].sort()).toEqual(['scalar', 'selection']);
  });

  it('says "not yet implemented" for a time series', () => {
    try {
      assertShapeImplemented('timeSeries', 'Input "wasteDeposited" of category 4A1');
      expect.unreachable('expected an unimplemented-shape error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unimplemented_input_shape');
      expect((error as EngineError).message).toContain('not yet implemented');
      expect((error as EngineError).message).toContain('wasteDeposited');
    }
  });

  it('says "not yet implemented" for a matrix', () => {
    try {
      assertShapeImplemented('matrix', 'Input "landUseChange" of category 3B');
      expect.unreachable('expected an unimplemented-shape error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unimplemented_input_shape');
      expect((error as EngineError).message).toContain('not yet implemented');
    }
  });

  it('constructs a time series and a matrix, so a module can declare them', () => {
    const history = timeSeries([
      { year: 1990, value: 120 },
      { year: 1991, value: 130 },
    ]);
    expect(history.shape).toBe('timeSeries');
    expect(history.points).toHaveLength(2);

    const transitions = matrix(['forest'], ['cropland'], [[4.2]]);
    expect(transitions.shape).toBe('matrix');
    expect(transitions.values[0][0]).toBe(4.2);
  });

  it('throws on an unimplemented shape rather than ignoring the value', () => {
    const schema: InputSchema = {
      categoryCode: '4A1',
      inputs: [
        {
          name: 'wasteDeposited',
          label: 'Waste deposited each year',
          shape: 'timeSeries',
          unit: 'Gg',
          description: 'Annual deposited tonnage, which First Order Decay integrates.',
          availableAtTiers: [1],
          requiredAtTiers: [1],
        },
      ],
    };

    // Supplied: rejected rather than silently unused.
    try {
      validateInputs(schema, { wasteDeposited: timeSeries([{ year: 1990, value: 120 }]) }, 1);
      expect.unreachable('expected an unimplemented-shape error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unimplemented_input_shape');
    }

    // Not supplied: still the shape that is the problem, not the absence.
    try {
      validateInputs(schema, {}, 1);
      expect.unreachable('expected an unimplemented-shape error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unimplemented_input_shape');
      expect((error as EngineError).message).toContain('wasteDeposited');
    }
  });

  it('accepts a schema of implemented shapes', () => {
    const schema: InputSchema = {
      categoryCode: '1A4b',
      inputs: [
        {
          name: 'mass',
          label: 'Mass burned',
          shape: 'scalar',
          unit: 'kg',
          description: 'Mass of fuel burned.',
          availableAtTiers: [1],
          requiredAtTiers: [1],
        },
      ],
    };
    expect(() => validateInputs(schema, { mass: scalar(1) }, 1)).not.toThrow();
  });
});
