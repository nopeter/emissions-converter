/**
 * The audit trail is part of the result, not debugging output.
 *
 * CLAUDE.md rule 1: every number shown to a user must be traceable to a cited
 * source. These tests assert that the engine hands the UI everything it needs to
 * do that, for every gas it reports.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import type { ParameterLibrary } from '../../data/types';
import { calculateFuelCombustion } from '../combustion';
import { EngineError } from '../errors';

describe('audit trail', () => {
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');

  it('echoes back every input', () => {
    // The quantity and its unit are echoed alongside the mass, because with
    // unit selection the two are no longer the same thing: 150 here happens to
    // be kilograms, but the audit has to say so rather than leave it implied.
    expect(result.audit.inputs).toEqual({
      fuelId: 'liquefied_petroleum_gases',
      quantity: 150,
      unitId: 'kg',
      massKg: 150,
      categoryCode: '1A4b',
      vehicleTechnology: null,
      activityDataUncertaintyPercent: null,
    });
  });

  it('records which version of the parameter library produced the figures', () => {
    expect(result.audit.library).toEqual({
      schemaVersion: parameters.schema_version,
      libraryVersion: parameters.library_version,
      updated: parameters.updated,
      methodology: parameters.methodology,
    });
  });

  it('shows the mass-to-energy conversion as arithmetic a reader can check', () => {
    expect(result.audit.energyConversion?.workings).toBe(
      '150 kg = 0.00015 Gg; 0.00015 Gg x 47.3 TJ/Gg = 0.007095 TJ',
    );
    expect(result.audit.energyConversion?.equation).toContain('Table 1.2');
  });

  it('shows the unit conversion too, even when there was nothing to convert', () => {
    // Kilograms in, kilograms out. The step is still recorded rather than
    // skipped: "no conversion was applied" is itself something the reader is
    // entitled to see stated, not something they should have to infer from an
    // empty list.
    expect(result.audit.conversion.steps).toHaveLength(1);
    expect(result.audit.conversion.steps[0]).toMatchObject({
      id: 'kg',
      provenance: 'exact',
      factor: 1,
      approximate: false,
    });
    expect(result.audit.conversion.outcome).toBe('mass');
    expect(result.audit.conversion.usesCalorificValue).toBe(true);
  });

  it('names Eq 2.1 and shows the substituted numbers for each gas', () => {
    const co2 = result.totalContributing.find((emission) => emission.gas === 'CO2');
    expect(co2?.audit.equation).toContain('Eq 2.1');
    expect(co2?.audit.workings).toBe('0.007095 TJ x 63100 kg/TJ = 447.6945 kg CO2');
  });

  it('carries a source string and provenance class for every factor used', () => {
    for (const emission of [...result.totalContributing, ...result.memoItems]) {
      expect(emission.audit.factors.length).toBeGreaterThan(0);
      for (const factor of emission.audit.factors) {
        expect(factor.source).toBeTruthy();
        expect(['ipcc', 'external', 'assumed']).toContain(factor.provenance);
        expect(factor.parameterId).toBeTruthy();
        expect(factor.unit).toBeTruthy();
      }
    }
  });

  it('records the tier of each emission factor', () => {
    for (const emission of result.totalContributing) {
      const factor = emission.audit.factors[emission.audit.factors.length - 1];
      expect(factor.tier).toBe(1);
      expect(emission.tier).toBe(1);
    }
  });

  it('lists every parameter the calculation touched at the top level', () => {
    expect(result.audit.factors.map((factor) => factor.parameterId)).toEqual([
      'ncv_lpg',
      'ef_1a4b_lpg_co2',
      'ef_1a4b_lpg_ch4',
      'ef_1a4b_lpg_n2o',
    ]);
  });
});

describe('missing and ambiguous factors fail loudly', () => {
  // The engine never returns a partial result. A result missing a gas would
  // read as a complete answer, and would hide a hole in the parameter library
  // instead of surfacing it.

  it('throws rather than substituting a similar fuel', () => {
    // The library carries no 1A3b charcoal factors at all: nobody burns charcoal
    // in a car, but the fuel and the category both exist, so the combination is
    // reachable and must fail rather than return nothing.
    expect(() => calculateFuelCombustion('charcoal', 10, '1A3b')).toThrowError(EngineError);
    expect(() => calculateFuelCombustion('charcoal', 10, '1A3b')).toThrowError(
      /No CO2 emission factor is published for fuel "charcoal" \(Charcoal\) in category "1A3b"/,
    );
  });

  it('names the input combination that triggered the failure', () => {
    try {
      calculateFuelCombustion('charcoal', 10, '1A3b');
      expect.unreachable('expected a missing-factor error');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      const engineError = error as EngineError;
      expect(engineError.code).toBe('missing_emission_factor');
      expect(engineError.message).toContain('charcoal');
      expect(engineError.message).toContain('1A3b');
      expect(engineError.message).toContain('does not substitute');
    }
  });

  it('refuses to choose between technology-specific factors on its own', () => {
    // Table 3.2.2 gives three CH4 factors for petrol, by vehicle technology.
    // Picking one is a Tier 3 decision and belongs to the user, not the engine.
    try {
      calculateFuelCombustion('motor_gasoline', 10, '1A3b');
      expect.unreachable('expected an ambiguous-factor error');
    } catch (error) {
      const engineError = error as EngineError;
      expect(engineError.code).toBe('ambiguous_emission_factor');
      expect(engineError.message).toContain('ef_1a3b_gasoline_uncontrolled_ch4');
      expect(engineError.message).toContain('ef_1a3b_gasoline_oxcat_ch4');
      expect(engineError.message).toContain('ef_1a3b_gasoline_ldv1995_ch4');
      expect(engineError.message).toContain('options.vehicleTechnology');
    }
  });

  it('throws on an unknown fuel, naming it', () => {
    try {
      calculateFuelCombustion('bituminous_coal', 10, '1A4b');
      expect.unreachable('expected an unknown-fuel error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_fuel');
      expect((error as EngineError).message).toContain('bituminous_coal');
    }
  });

  it('throws on an unknown category, listing the ones that exist', () => {
    try {
      calculateFuelCombustion('charcoal', 10, '1A9z');
      expect.unreachable('expected an unknown-category error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_category');
      expect((error as EngineError).message).toContain('1A9z');
      expect((error as EngineError).message).toContain('1A4b');
    }
  });

  it('throws when a fuel has no net calorific value', () => {
    // Constructed against a library with the charcoal NCV removed, because the
    // real library is complete — and a data-integrity test keeps it that way.
    const withoutCharcoalNcv: ParameterLibrary = {
      ...parameters,
      net_calorific_values: parameters.net_calorific_values.filter(
        (ncv) => ncv.fuel !== 'charcoal',
      ),
    };

    try {
      calculateFuelCombustion('charcoal', 10, '1A4b', {}, withoutCharcoalNcv);
      expect.unreachable('expected a missing-calorific-value error');
    } catch (error) {
      expect((error as EngineError).code).toBe('missing_calorific_value');
      expect((error as EngineError).message).toContain('charcoal');
      expect((error as EngineError).message).toContain('will not estimate one');
    }
  });

  it('throws when a published factor has a null value', () => {
    // A record can exist and still carry no number; densities in the library do
    // exactly that. Such a value must never reach the arithmetic.
    const withNullFactor: ParameterLibrary = {
      ...parameters,
      emission_factors: parameters.emission_factors.map((factor) =>
        factor.id === 'ef_1a4b_charcoal_ch4'
          ? { ...factor, value: null as unknown as number }
          : factor,
      ),
    };

    try {
      calculateFuelCombustion('charcoal', 10, '1A4b', {}, withNullFactor);
      expect.unreachable('expected a null-value error');
    } catch (error) {
      expect((error as EngineError).code).toBe('null_parameter_value');
      expect((error as EngineError).message).toContain('ef_1a4b_charcoal_ch4');
    }
  });
});

describe('a technology selection applies only to the gases it disaggregates', () => {
  // 10 kg petrol, road transport (1A3b).
  //
  //   mass   = 10 kg = 1e-5 Gg
  //   NCV    = 44.3 TJ/Gg           (Vol 2 Ch 1, Table 1.2)
  //   energy = 1e-5 x 44.3          = 0.000443 TJ
  //
  //   CO2 EF = 69 300 kg/TJ         (Vol 2 Ch 3, Table 3.2.1 — no technology split)
  //   CO2    = 0.000443 x 69300     = 30.6999 kg
  //
  //   CH4 EF = 33 kg/TJ, uncontrolled  (Vol 2 Ch 3, Table 3.2.2)
  //   CH4    = 0.000443 x 33        = 0.014619 kg
  //
  //   N2O EF = 3.2 kg/TJ, uncontrolled (Vol 2 Ch 3, Table 3.2.2)
  //   N2O    = 0.000443 x 3.2       = 0.0014176 kg
  const result = calculateFuelCombustion('motor_gasoline', 10, '1A3b', {
    vehicleTechnology: 'uncontrolled',
  });

  it('uses the Tier 3 CH4 factor once a technology is selected', () => {
    const ch4 = result.totalContributing.find((emission) => emission.gas === 'CH4');
    expect(ch4?.kg).toBeCloseTo(0.014619, 10);
    expect(ch4?.tier).toBe(3);
    expect(result.audit.inputs.vehicleTechnology).toBe('uncontrolled');
  });

  it('uses the Tier 3 N2O factor too', () => {
    const n2o = result.totalContributing.find((emission) => emission.gas === 'N2O');
    expect(n2o?.kg).toBeCloseTo(0.0014176, 12);
    expect(n2o?.tier).toBe(3);
  });

  it('still applies the Tier 1 CO2 factor, which has no technology split', () => {
    // Table 3.2.1 publishes one CO2 factor for petrol regardless of technology.
    // Selecting a technology must not filter it out and abort the calculation.
    const co2 = result.totalContributing.find((emission) => emission.gas === 'CO2');
    expect(co2?.kg).toBeCloseTo(30.6999, 8);
    expect(co2?.tier).toBe(1);
  });

  it('produces all three gases, so nothing was silently dropped', () => {
    expect(result.totalContributing.map((emission) => emission.gas)).toEqual([
      'CO2',
      'CH4',
      'N2O',
    ]);
  });
});
