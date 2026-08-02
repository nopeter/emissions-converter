/**
 * Fixture tests for Vol 2 Ch 2 Eq 2.1.
 *
 * Every expected value below is derived by hand from the cited IPCC table, with
 * the derivation written out. If one of these fails, the arithmetic or the
 * parameter library changed — check the derivation before changing the test.
 *
 * Shared conversion: 1 kg = 1e-6 Gg, so mass_Gg = mass_kg / 1 000 000.
 * Shared equation: Emission (kg) = energy (TJ) x emission factor (kg/TJ).
 */
import { describe, expect, it } from 'vitest';
import { calculateFuelCombustion } from '../combustion';
import type { GasEmission } from '../types';

function gas(emissions: GasEmission[], name: string): GasEmission {
  const found = emissions.find((emission) => emission.gas === name);
  if (!found) {
    throw new Error(`Expected a ${name} figure, got: ${emissions.map((e) => e.gas).join(', ')}`);
  }
  return found;
}

describe('LPG, residential (1A4b) — the reference fixture from CLAUDE.md', () => {
  // 150 kg LPG, residential.
  //
  //   mass    = 150 kg = 150e-6 Gg = 1.5e-4 Gg
  //   NCV     = 47.3 TJ/Gg          (Vol 2 Ch 1, Table 1.2)
  //   energy  = 1.5e-4 x 47.3       = 0.007095 TJ
  //
  //   CO2 EF  = 63 100 kg/TJ        (Vol 2 Ch 2, Table 2.5)
  //   CO2     = 0.007095 x 63100    = 447.6945 kg
  //
  //   CH4 EF  = 5 kg/TJ             (Vol 2 Ch 2, Table 2.5)
  //   CH4     = 0.007095 x 5        = 0.035475 kg
  //
  //   N2O EF  = 0.1 kg/TJ           (Vol 2 Ch 2, Table 2.5)
  //   N2O     = 0.007095 x 0.1      = 0.0007095 kg
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');

  it('converts 150 kg to 0.007095 TJ', () => {
    expect(result.energyTJ).toBeCloseTo(0.007095, 12);
  });

  it('produces 447.7 kg CO2', () => {
    expect(gas(result.totalContributing, 'CO2').kg).toBeCloseTo(447.6945, 6);
  });

  it('produces 0.0355 kg CH4', () => {
    expect(gas(result.totalContributing, 'CH4').kg).toBeCloseTo(0.035475, 10);
  });

  it('produces 0.00071 kg N2O', () => {
    expect(gas(result.totalContributing, 'N2O').kg).toBeCloseTo(0.0007095, 12);
  });

  it('reports all three gases in the total, and nothing as a memo item', () => {
    expect(result.totalContributing.map((emission) => emission.gas)).toEqual([
      'CO2',
      'CH4',
      'N2O',
    ]);
    expect(result.memoItems).toHaveLength(0);
  });

  it('keeps the gases separate rather than summing them', () => {
    // CO2-equivalent is a derived view that this engine does not yet produce.
    expect(result).not.toHaveProperty('co2eq');
    expect(result).not.toHaveProperty('total');
  });

  it('reports no gaps: every factor this fixture needs is published', () => {
    expect(result.gaps).toEqual([]);
  });
});

describe('Charcoal, residential (1A4b)', () => {
  // 50 kg charcoal, residential.
  //
  //   mass    = 50 kg = 50e-6 Gg = 5e-5 Gg
  //   NCV     = 29.5 TJ/Gg           (Vol 2 Ch 1, Table 1.2)
  //   energy  = 5e-5 x 29.5          = 0.001475 TJ
  //
  //   CO2 EF  = 112 000 kg/TJ        (Vol 2 Ch 2, Table 2.5)
  //   CO2     = 0.001475 x 112000    = 165.2 kg      -> MEMO ITEM (biomass)
  //
  //   CH4 EF  = 200 kg/TJ            (Vol 2 Ch 2, Table 2.5)
  //   CH4     = 0.001475 x 200       = 0.295 kg      -> counts towards the total
  //
  //   N2O EF  = 1 kg/TJ              (Vol 2 Ch 2, Table 2.5)
  //   N2O     = 0.001475 x 1         = 0.001475 kg   -> counts towards the total
  const result = calculateFuelCombustion('charcoal', 50, '1A4b');

  it('converts 50 kg to 0.001475 TJ', () => {
    expect(result.energyTJ).toBeCloseTo(0.001475, 12);
  });

  it('reports 165.2 kg CO2 as a memo item, not in the total', () => {
    const co2 = gas(result.memoItems, 'CO2');
    expect(co2.kg).toBeCloseTo(165.2, 8);
    expect(co2.memoItem).toBe(true);
    expect(co2.memoReason).toContain('information items');
  });

  it('produces 0.295 kg CH4, counted towards the total', () => {
    expect(gas(result.totalContributing, 'CH4').kg).toBeCloseTo(0.295, 10);
  });

  it('produces 0.001475 kg N2O, counted towards the total', () => {
    expect(gas(result.totalContributing, 'N2O').kg).toBeCloseTo(0.001475, 12);
  });

  it('splits the gases the way Vol 2 Ch 2 requires', () => {
    expect(result.memoItems.map((emission) => emission.gas)).toEqual(['CO2']);
    expect(result.totalContributing.map((emission) => emission.gas)).toEqual(['CH4', 'N2O']);
  });
});

describe('Firewood, residential (1A4b)', () => {
  // 100 kg firewood / wood waste, residential.
  //
  //   mass    = 100 kg = 100e-6 Gg = 1e-4 Gg
  //   NCV     = 15.6 TJ/Gg           (Vol 2 Ch 1, Table 1.2)
  //   energy  = 1e-4 x 15.6          = 0.00156 TJ
  //
  //   CO2 EF  = 112 000 kg/TJ        (Vol 2 Ch 2, Table 2.5)
  //   CO2     = 0.00156 x 112000     = 174.72 kg     -> MEMO ITEM (biomass)
  //
  //   CH4 EF  = 300 kg/TJ            (Vol 2 Ch 2, Table 2.5)
  //   CH4     = 0.00156 x 300        = 0.468 kg      -> counts towards the total
  //
  //   N2O EF  = 4 kg/TJ              (Vol 2 Ch 2, Table 2.5)
  //   N2O     = 0.00156 x 4          = 0.00624 kg    -> counts towards the total
  const result = calculateFuelCombustion('wood_wood_waste', 100, '1A4b');

  it('converts 100 kg to 0.00156 TJ', () => {
    expect(result.energyTJ).toBeCloseTo(0.00156, 12);
  });

  it('reports 174.72 kg CO2 as a memo item, not in the total', () => {
    const co2 = gas(result.memoItems, 'CO2');
    expect(co2.kg).toBeCloseTo(174.72, 8);
    expect(co2.memoItem).toBe(true);
  });

  it('produces 0.468 kg CH4, counted towards the total', () => {
    expect(gas(result.totalContributing, 'CH4').kg).toBeCloseTo(0.468, 10);
  });

  it('produces 0.00624 kg N2O, counted towards the total', () => {
    expect(gas(result.totalContributing, 'N2O').kg).toBeCloseTo(0.00624, 12);
  });
});

describe('linearity in mass', () => {
  it('doubling the mass doubles every gas', () => {
    // Eq 2.1 is a product, so this must hold exactly for the arithmetic and
    // guards against a factor being applied twice somewhere.
    const single = calculateFuelCombustion('wood_wood_waste', 100, '1A4b');
    const double = calculateFuelCombustion('wood_wood_waste', 200, '1A4b');

    expect(gas(double.totalContributing, 'CH4').kg).toBeCloseTo(
      gas(single.totalContributing, 'CH4').kg * 2,
      12,
    );
    expect(gas(double.memoItems, 'CO2').kg).toBeCloseTo(gas(single.memoItems, 'CO2').kg * 2, 8);
  });

  it('returns zero for zero mass without inventing anything', () => {
    const result = calculateFuelCombustion('charcoal', 0, '1A4b');
    expect(result.energyTJ).toBe(0);
    expect(gas(result.totalContributing, 'CH4').kg).toBe(0);
    expect(gas(result.memoItems, 'CO2').kg).toBe(0);
  });
});

describe('input validation', () => {
  it('rejects an unknown fuel rather than substituting a similar one', () => {
    expect(() => calculateFuelCombustion('bituminous_coal', 10, '1A4b')).toThrowError(
      /No fuel with id/,
    );
  });

  it('rejects an unknown category', () => {
    expect(() => calculateFuelCombustion('charcoal', 10, '1A9z')).toThrowError(
      /No category with code/,
    );
  });

  it('rejects a negative mass', () => {
    expect(() => calculateFuelCombustion('charcoal', -1, '1A4b')).toThrowError(/non-negative/);
  });
});
