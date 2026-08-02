/**
 * The audit trail is part of the result, not debugging output.
 *
 * CLAUDE.md rule 1: every number shown to a user must be traceable to a cited
 * source. These tests assert that the engine hands the UI everything it needs to
 * do that, for every gas it reports.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import { calculateFuelCombustion } from '../combustion';

describe('audit trail', () => {
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');

  it('echoes back every input', () => {
    expect(result.audit.inputs).toEqual({
      fuelId: 'liquefied_petroleum_gases',
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
    expect(result.audit.energyConversion.workings).toBe(
      '150 kg = 0.00015 Gg; 0.00015 Gg x 47.3 TJ/Gg = 0.007095 TJ',
    );
    expect(result.audit.energyConversion.equation).toContain('Table 1.2');
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

describe('gaps are reported, never filled', () => {
  it('reports a missing factor instead of substituting a similar fuel', () => {
    // Vol 2 Ch 3 publishes no CH4 or N2O factors for charcoal in road transport,
    // and the library carries no 1A3b charcoal factors at all.
    const result = calculateFuelCombustion('charcoal', 10, '1A3b');
    expect(result.totalContributing).toEqual([]);
    expect(result.memoItems).toEqual([]);
    expect(result.gaps.map((gap) => gap.gas)).toEqual(['CO2', 'CH4', 'N2O']);
    for (const gap of result.gaps) {
      expect(gap.kind).toBe('missing_emission_factor');
      expect(gap.message).toContain('does not substitute');
    }
  });

  it('refuses to choose between technology-specific factors on its own', () => {
    // Table 3.2.2 gives three CH4 factors for petrol, by vehicle technology.
    // Picking one is a Tier 3 decision and belongs to the user, not the engine.
    const result = calculateFuelCombustion('motor_gasoline', 10, '1A3b');
    const ch4Gap = result.gaps.find((gap) => gap.gas === 'CH4');
    expect(ch4Gap?.kind).toBe('ambiguous_emission_factor');
    expect(result.totalContributing.map((emission) => emission.gas)).toEqual(['CO2']);
  });

  it('uses the technology-specific factor once one is selected', () => {
    // 10 kg petrol = 1e-5 Gg; energy = 1e-5 x 44.3 = 0.000443 TJ
    // Uncontrolled CH4 EF 33 kg/TJ -> 0.000443 x 33 = 0.014619 kg
    const result = calculateFuelCombustion('motor_gasoline', 10, '1A3b', {
      vehicleTechnology: 'uncontrolled',
    });
    const ch4 = result.totalContributing.find((emission) => emission.gas === 'CH4');
    expect(ch4?.kg).toBeCloseTo(0.014619, 10);
    expect(ch4?.tier).toBe(3);
    expect(result.audit.inputs.vehicleTechnology).toBe('uncontrolled');
  });
});
