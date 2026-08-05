/**
 * Uncertainty propagation fixtures, Vol 1 Ch 3 Eq 3.1.
 *
 *   U_total = sqrt(U1^2 + U2^2 + ... + Un^2)
 *
 * Each U is a half-width expressed as a percentage of the central value:
 *
 *   U = ((ci95_high - ci95_low) / 2) / value x 100
 *
 * Every expected figure below is worked out from the parameter library by hand.
 */
import { describe, expect, it } from 'vitest';
import { calculateFuelCombustion } from '../combustion';
import {
  combineAdditive,
  combineMultiplicative,
  evaluateCandidate,
  intervalToPercent,
  isAsymmetric,
} from '../uncertainty';
import type { GasEmission } from '../types';

function gas(emissions: GasEmission[], name: string): GasEmission {
  const found = emissions.find((emission) => emission.gas === name);
  if (!found) {
    throw new Error(`Expected a ${name} figure`);
  }
  return found;
}

describe('interval to percentage', () => {
  it('halves the width of a symmetric interval', () => {
    // value 100, interval [90, 110]: half-width 10, so 10%.
    expect(intervalToPercent(100, 90, 110)).toBeCloseTo(10, 12);
    expect(isAsymmetric(100, 90, 110)).toBe(false);
  });

  it('recognises an asymmetric interval', () => {
    // LPG NCV 47.3, interval [44.8, 52.2]: 2.5 below, 4.9 above.
    expect(isAsymmetric(47.3, 44.8, 52.2)).toBe(true);
  });
});

describe('LPG residential CO2, uncertainty', () => {
  // NCV 47.3 TJ/Gg, interval [44.8, 52.2]   (Vol 2 Ch 1, Table 1.2)
  //   half-width = (52.2 - 44.8) / 2 = 3.7
  //   U_ncv      = 3.7 / 47.3 x 100  = 7.822410148 %
  //
  // CO2 EF 63 100 kg/TJ, interval [61 600, 65 600]  (Vol 2 Ch 2, Table 2.5)
  //   half-width = (65600 - 61600) / 2 = 2000
  //   U_ef       = 2000 / 63100 x 100  = 3.169572108 %
  //
  // Eq 3.1: U = sqrt(7.822410148^2 + 3.169572108^2)
  //           = sqrt(61.190100 + 10.046187)
  //           = sqrt(71.236287)
  //           = 8.440159232 %
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');
  const co2 = gas(result.totalContributing, 'CO2');

  it('combines the two published intervals with Eq 3.1', () => {
    expect(co2.uncertainty.percent).toBeCloseTo(8.440159232, 8);
  });

  it('names Eq 3.1 as the equation applied', () => {
    expect(co2.uncertainty.equation).toContain('Eq 3.1');
  });

  it('flags both asymmetric intervals as having been symmetrised', () => {
    // Neither interval is symmetric about its central value, so both are
    // simplified and both must be named in the output.
    expect(co2.uncertainty.symmetrisedParameters).toEqual(['ncv_lpg', 'ef_1a4b_lpg_co2']);
    for (const term of co2.uncertainty.terms) {
      expect(term.asymmetric).toBe(true);
      expect(term.symmetrisation).toMatch(/not\s+symmetric/);
    }
  });

  it('skips the activity-data term and says so, rather than assuming the mass is exact', () => {
    expect(co2.uncertainty.incomplete).toBe(true);
    const skipped = co2.uncertainty.skipped.map((term) => term.parameterId);
    expect(skipped).toEqual(['activity_data']);
    expect(co2.uncertainty.skipped[0].reason).toBe('not_provided');
  });

  it('includes the activity-data term when the caller supplies one', () => {
    // With a 5% mass uncertainty:
    //   U = sqrt(5^2 + 7.822410148^2 + 3.169572108^2)
    //     = sqrt(25 + 61.190100 + 10.046187)
    //     = sqrt(96.236287)
    //     = 9.810009575 %
    const withActivity = calculateFuelCombustion(
      'liquefied_petroleum_gases',
      150,
      '1A4b',
      { activityDataUncertaintyPercent: 5 },
    );
    const withActivityCo2 = gas(withActivity.totalContributing, 'CO2');
    expect(withActivityCo2.uncertainty.percent).toBeCloseTo(9.810009575, 8);
    expect(withActivityCo2.uncertainty.incomplete).toBe(false);
    expect(withActivityCo2.uncertainty.skipped).toEqual([]);
  });
});

describe('charcoal residential, uncertainty', () => {
  // NCV 29.5 TJ/Gg, interval [14.9, 58.0]
  //   half-width = (58.0 - 14.9) / 2 = 21.55
  //   U_ncv      = 21.55 / 29.5 x 100 = 73.050847458 %
  //
  // CO2 EF 112 000 kg/TJ, interval [95 000, 132 000]
  //   half-width = (132000 - 95000) / 2 = 18500
  //   U_ef       = 18500 / 112000 x 100 = 16.517857143 %
  //
  // Eq 3.1: U = sqrt(73.050847458^2 + 16.517857143^2)
  //           = sqrt(5336.426... + 272.839...)
  //           = 74.895032672 %
  //
  // CH4 EF 200 kg/TJ, interval [70, 600]
  //   half-width = (600 - 70) / 2 = 265
  //   U_ef       = 265 / 200 x 100 = 132.5 %
  //
  // Eq 3.1: U = sqrt(73.050847458^2 + 132.5^2) = 151.303259430 %
  const result = calculateFuelCombustion('charcoal', 50, '1A4b');

  it('propagates the very wide charcoal NCV into the memo CO2 figure', () => {
    expect(gas(result.memoItems, 'CO2').uncertainty.percent).toBeCloseTo(74.895032672, 8);
  });

  it('propagates it into CH4 as well', () => {
    expect(gas(result.totalContributing, 'CH4').uncertainty.percent).toBeCloseTo(
      151.303259430,
      8,
    );
  });
});

describe('firewood residential, uncertainty', () => {
  // NCV 15.6 TJ/Gg, interval [7.9, 31.0] — moisture content drives the width.
  //   half-width = (31.0 - 7.9) / 2 = 11.55
  //   U_ncv      = 11.55 / 15.6 x 100 = 74.038461538 %
  //
  // CO2 EF 112 000 kg/TJ, U_ef = 16.517857143 % (as above)
  //
  // Eq 3.1: U = sqrt(74.038461538^2 + 16.517857143^2) = 75.858640850 %
  it('propagates the firewood NCV into the memo CO2 figure', () => {
    const result = calculateFuelCombustion('wood_wood_waste', 100, '1A4b');
    expect(gas(result.memoItems, 'CO2').uncertainty.percent).toBeCloseTo(75.858640850, 8);
  });
});

describe('a factor with no published interval', () => {
  // Vol 2 Ch 3, Table 3.2.2 publishes CH4 and N2O factors for LPG in road
  // transport but states that uncertainty ranges were not provided. Those terms
  // must be skipped and the skip recorded — never treated as zero uncertainty.
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 10, '1A3b');

  it('still produces the emission figure', () => {
    // 10 kg = 1e-5 Gg; energy = 1e-5 x 47.3 = 0.000473 TJ
    // CH4 EF 62 kg/TJ -> 0.000473 x 62 = 0.029326 kg
    expect(gas(result.totalContributing, 'CH4').kg).toBeCloseTo(0.029326, 10);
  });

  it('drops the emission-factor term from Eq 3.1 and records why', () => {
    const ch4 = gas(result.totalContributing, 'CH4');
    const skipped = ch4.uncertainty.skipped.find(
      (term) => term.parameterId === 'ef_1a3b_lpg_ch4',
    );
    expect(skipped).toBeDefined();
    expect(skipped?.reason).toBe('confidence_interval_not_published');
    expect(ch4.uncertainty.incomplete).toBe(true);
  });

  it('leaves only the NCV term in the combination, so the figure is a lower bound', () => {
    // Only U_ncv survives: sqrt(7.822410148^2) = 7.822410148 %
    const ch4 = gas(result.totalContributing, 'CH4');
    expect(ch4.uncertainty.terms.map((term) => term.parameterId)).toEqual(['ncv_lpg']);
    expect(ch4.uncertainty.percent).toBeCloseTo(7.822410148, 8);
  });
});

describe('combineMultiplicative', () => {
  const equation = 'U_total = sqrt(U1^2 + ... + Un^2)';

  it('returns null when every term was skipped', () => {
    const result = combineMultiplicative(
      [
        {
          parameterId: 'a',
          role: 'emission_factor',
          label: 'A',
          value: 1,
          ci95Low: null,
          ci95High: null,
        },
      ],
      equation,
    );
    expect(result.percent).toBeNull();
    expect(result.incomplete).toBe(true);
  });

  it('adds in quadrature, not linearly', () => {
    // sqrt(3^2 + 4^2) = 5, which linear addition would give as 7.
    const result = combineMultiplicative(
      [
        {
          parameterId: 'a',
          role: 'emission_factor',
          label: 'A',
          value: 100,
          ci95Low: 97,
          ci95High: 103,
        },
        {
          parameterId: 'b',
          role: 'net_calorific_value',
          label: 'B',
          value: 100,
          ci95Low: 96,
          ci95High: 104,
        },
      ],
      equation,
    );
    expect(result.percent).toBeCloseTo(5, 12);
  });

  it('skips a term whose central value is zero', () => {
    const outcome = evaluateCandidate({
      parameterId: 'z',
      role: 'emission_factor',
      label: 'Z',
      value: 0,
      ci95Low: -1,
      ci95High: 1,
    });
    expect('skipped' in outcome && outcome.skipped.reason).toBe('zero_central_value');
  });
});

/**
 * Vol 1 Ch 3 Eq 3.2, addition.
 *
 *   U_total = sqrt(sum((Ui x xi)^2)) / |sum(xi)|
 *
 * The difference from Eq 3.1 that matters is the weighting: a term's influence
 * scales with its size, so a large uncertainty on a small quantity barely moves
 * the total. These fixtures are chosen so the arithmetic can be checked by eye.
 */
describe('Eq 3.2, addition', () => {
  const equation = 'U_total = sqrt(sum((Ui * xi)^2)) / sum(xi)  [Vol 1 Ch 3, Eq 3.2]';

  it('combines two equal terms to U / sqrt(2)', () => {
    //   x1 = 100, U1 = 10 %;  x2 = 100, U2 = 10 %
    //   numerator   = sqrt((10 x 100)^2 + (10 x 100)^2) = sqrt(2) x 1000
    //   denominator = 200
    //   U_total     = sqrt(2) x 1000 / 200 = 10 / sqrt(2) = 7.0710678...
    const result = combineAdditive(
      [
        { parameterId: 'a', role: 'emission_factor', label: 'A', value: 100, percent: 10 },
        { parameterId: 'b', role: 'emission_factor', label: 'B', value: 100, percent: 10 },
      ],
      equation,
    );
    expect(result.percent).toBeCloseTo(10 / Math.SQRT2, 12);
  });

  it('weights each term by its size, not just by its percentage', () => {
    //   x1 = 1000, U1 =  1 %  ->  Ui x xi = 1000
    //   x2 =   10, U2 = 50 %  ->  Ui x xi =  500
    //   numerator   = sqrt(1000^2 + 500^2) = sqrt(1 250 000) = 1118.033988749895
    //   denominator = 1010
    //   U_total     = 1.10696434529693 %
    //
    // The 50 % term moves the total by about a tenth of a percentage point.
    // Under Eq 3.1 it would have dominated, which is why using the wrong
    // equation here would be a large, silent error rather than a rounding one.
    const result = combineAdditive(
      [
        { parameterId: 'big', role: 'emission_factor', label: 'Big', value: 1000, percent: 1 },
        { parameterId: 'small', role: 'emission_factor', label: 'Small', value: 10, percent: 50 },
      ],
      equation,
    );
    expect(result.percent).toBeCloseTo(Math.sqrt(1_250_000) / 1010, 12);
    expect(result.percent).toBeCloseTo(1.10696434529693, 10);
  });

  it('leaves out a term with no quantified uncertainty and says so', () => {
    const result = combineAdditive(
      [
        { parameterId: 'a', role: 'emission_factor', label: 'A', value: 100, percent: 10 },
        { parameterId: 'b', role: 'emission_factor', label: 'B', value: 100, percent: null },
      ],
      equation,
    );
    // Only A is combined, so the figure is A's own percentage and is a lower bound.
    expect(result.percent).toBeCloseTo(10, 12);
    expect(result.incomplete).toBe(true);
    expect(result.skipped.map((term) => term.parameterId)).toEqual(['b']);
    expect(result.skipped[0].reason).toBe('confidence_interval_not_published');
  });

  it('leaves out a term that contributes nothing to the sum', () => {
    const result = combineAdditive(
      [
        { parameterId: 'a', role: 'emission_factor', label: 'A', value: 100, percent: 10 },
        { parameterId: 'zero', role: 'emission_factor', label: 'Zero', value: 0, percent: 40 },
      ],
      equation,
    );
    expect(result.percent).toBeCloseTo(10, 12);
    expect(result.skipped.map((term) => term.reason)).toEqual(['zero_central_value']);
  });

  it('returns null rather than dividing by a zero sum', () => {
    const result = combineAdditive(
      [{ parameterId: 'a', role: 'emission_factor', label: 'A', value: 0, percent: 10 }],
      equation,
    );
    expect(result.percent).toBeNull();
  });

  it('carries omissions and symmetrisations from an earlier step', () => {
    // An Eq 3.1 step happens before this one, per gas. What it had to leave out
    // must not be forgotten when its output is added up.
    const result = combineAdditive(
      [{ parameterId: 'a', role: 'emission_factor', label: 'A', value: 100, percent: 10 }],
      equation,
      [
        {
          parameterId: 'earlier',
          role: 'global_warming_potential',
          label: 'Earlier omission',
          reason: 'confidence_interval_not_published',
          note: 'No interval published.',
        },
      ],
      ['ncv_lpg'],
    );
    expect(result.incomplete).toBe(true);
    expect(result.skipped.map((term) => term.parameterId)).toEqual(['earlier']);
    expect(result.symmetrisedParameters).toEqual(['ncv_lpg']);
  });
});
