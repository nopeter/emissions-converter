/**
 * Fixture tests for the CO2-equivalent view.
 *
 * Every expected value is derived by hand from the parameter library, with the
 * derivation written out. The gas figures reuse the CLAUDE.md reference fixture
 * so that only the GWP step is new arithmetic.
 *
 * GWP values are `external` and unverified, so these fixtures pin the
 * calculator's behaviour, not the correctness of the GWPs themselves. If a GWP
 * is corrected against its primary table, these numbers change and should.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import { toCarbonDioxideEquivalent } from '../co2e';
import { calculateFuelCombustion } from '../combustion';
import { EngineError } from '../errors';
import type { GasCarbonDioxideEquivalent } from '../types';

const AR6 = 'gwp_ar6_100';
const AR5 = 'gwp_ar5_100';
const SAR = 'gwp_sar_100';

function entry(entries: GasCarbonDioxideEquivalent[], gas: string): GasCarbonDioxideEquivalent {
  const found = entries.find((candidate) => candidate.gas === gas);
  if (!found) {
    throw new Error(`Expected a ${gas} entry, got: ${entries.map((e) => e.gas).join(', ')}`);
  }
  return found;
}

describe('LPG, residential (1A4b), AR6 — a fossil fuel with nothing in memo', () => {
  // Gases, from the CLAUDE.md reference fixture:
  //   energy = 150 kg = 1.5e-4 Gg x 47.3 TJ/Gg = 0.007095 TJ
  //   CO2    = 0.007095 x 63 100 = 447.6945   kg
  //   CH4    = 0.007095 x 5      =   0.035475 kg
  //   N2O    = 0.007095 x 0.1    =   0.0007095 kg
  //
  // AR6 100-year GWPs. LPG is a fossil fuel, so the fossil methane value
  // applies:
  //   CO2 x 1     = 447.6945
  //   CH4 x 29.8  =   0.035475 x 29.8 = 1.057155
  //   N2O x 273   =   0.0007095 x 273 = 0.1936935
  //   total       = 447.6945 + 1.057155 + 0.1936935 = 448.9453485 kg CO2-eq
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');
  const co2e = toCarbonDioxideEquivalent(result, AR6);

  it('totals 448.9453485 kg CO2-eq', () => {
    expect(co2e.totalKg).toBeCloseTo(448.9453485, 9);
  });

  it('converts each gas with the GWP for that gas', () => {
    expect(entry(co2e.contributing, 'CO2').co2eKg).toBeCloseTo(447.6945, 9);
    expect(entry(co2e.contributing, 'CH4').co2eKg).toBeCloseTo(1.057155, 12);
    expect(entry(co2e.contributing, 'N2O').co2eKg).toBeCloseTo(0.1936935, 12);
  });

  it('picks the fossil methane GWP, 29.8', () => {
    const methane = entry(co2e.contributing, 'CH4');
    expect(methane.gwp.value).toBe(29.8);
    expect(methane.gwp.origin).toBe('fossil');
    expect(methane.gwp.valueId).toBe('gwp_ar6_100_ch4_fossil');
  });

  it('leaves the gas figures untouched', () => {
    // CO2-equivalent is a view over the result, not a recalculation of it.
    expect(entry(co2e.contributing, 'CO2').kg).toBeCloseTo(447.6945, 6);
    expect(result.totalContributing).toHaveLength(3);
  });

  it('has nothing in memo, because LPG is not biomass', () => {
    expect(co2e.memoItems).toHaveLength(0);
    expect(co2e.memoTotalKg).toBe(0);
  });

  it('names the set that produced the figure', () => {
    expect(co2e.gwpSet.id).toBe(AR6);
    expect(co2e.gwpSet.label).toContain('AR6');
    expect(co2e.gwpSet.horizonYears).toBe(100);
  });
});

describe('charcoal, residential (1A4b), AR6 — biomass CO2 stays out of the total', () => {
  // 50 kg charcoal, residential.
  //   mass   = 50 kg = 5e-5 Gg
  //   NCV    = 29.5 TJ/Gg           (Vol 2 Ch 1, Table 1.2)
  //   energy = 5e-5 x 29.5          = 0.001475 TJ
  //
  //   CO2 EF = 112 000 kg/TJ        (Vol 2 Ch 2, Table 2.5) — memo item
  //   CO2    = 0.001475 x 112000    = 165.2     kg
  //   CH4 EF = 200 kg/TJ
  //   CH4    = 0.001475 x 200       =   0.295   kg
  //   N2O EF = 1 kg/TJ
  //   N2O    = 0.001475 x 1         =   0.001475 kg
  //
  // AR6. Charcoal is biomass, so the non-fossil methane value applies:
  //   CH4 x 27.0 = 0.295    x 27  = 7.965
  //   N2O x 273  = 0.001475 x 273 = 0.402675
  //   total      = 7.965 + 0.402675 = 8.367675 kg CO2-eq
  //
  //   memo: CO2 x 1 = 165.2 kg CO2-eq, reported beside the total, never in it.
  const result = calculateFuelCombustion('charcoal', 50, '1A4b');
  const co2e = toCarbonDioxideEquivalent(result, AR6);

  it('totals 8.367675 kg CO2-eq, from methane and nitrous oxide only', () => {
    expect(co2e.totalKg).toBeCloseTo(8.367675, 10);
    expect(co2e.contributing.map((item) => item.gas)).toEqual(['CH4', 'N2O']);
  });

  it('reports 165.2 kg CO2-eq of biomass CO2 as a memo item', () => {
    expect(co2e.memoTotalKg).toBeCloseTo(165.2, 9);
    expect(entry(co2e.memoItems, 'CO2').co2eKg).toBeCloseTo(165.2, 9);
    expect(entry(co2e.memoItems, 'CO2').memoItem).toBe(true);
  });

  it('does not add the memo item to the total, even though it is the larger number', () => {
    // Vol 2 Ch 2: biomass CO2 is an information item, excluded from sectoral and
    // national totals. It is ~20x the total here, so a regression that folded it
    // in would be both large and plausible-looking.
    expect(co2e.totalKg).toBeLessThan(co2e.memoTotalKg);
    expect(co2e.totalKg + co2e.memoTotalKg).toBeCloseTo(173.567675, 9);
    expect(co2e.totalKg).not.toBeCloseTo(173.567675, 3);
  });

  it('picks the non-fossil methane GWP, 27.0', () => {
    const methane = entry(co2e.contributing, 'CH4');
    expect(methane.gwp.value).toBe(27.0);
    expect(methane.gwp.origin).toBe('non_fossil');
    expect(methane.gwp.valueId).toBe('gwp_ar6_100_ch4_non_fossil');
    expect(methane.gwp.originReason).toContain('biomass');
  });

  it('says in a caveat that the memo figure is not in the total', () => {
    const memoGap = co2e.gaps.find((gap) => gap.gas === 'CO2');
    expect(memoGap?.message).toContain('not included in the total');
    expect(memoGap?.message).toContain('165.2');
  });
});

describe('the GWP set is the caller’s choice, and changes the answer', () => {
  const charcoal = calculateFuelCombustion('charcoal', 50, '1A4b');

  it('gives charcoal a different total under each set', () => {
    //   AR5: CH4 x 28 = 8.26,     N2O x 265 = 0.390875  -> 8.650875
    //   SAR: CH4 x 21 = 6.195,    N2O x 310 = 0.45725   -> 6.65225
    expect(toCarbonDioxideEquivalent(charcoal, AR5).totalKg).toBeCloseTo(8.650875, 10);
    expect(toCarbonDioxideEquivalent(charcoal, SAR).totalKg).toBeCloseTo(6.65225, 10);
  });

  it('uses one methane value for a set that does not split by origin', () => {
    // AR5 publishes a single CH4 GWP, so biomass makes no difference to which
    // value is used — only AR6 asks the question.
    const biomass = toCarbonDioxideEquivalent(charcoal, AR5);
    const fossil = toCarbonDioxideEquivalent(
      calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b'),
      AR5,
    );
    expect(entry(biomass.contributing, 'CH4').gwp.value).toBe(28);
    expect(entry(fossil.contributing, 'CH4').gwp.value).toBe(28);
    expect(entry(biomass.contributing, 'CH4').gwp.origin).toBe('all');
  });

  it('produces a result for every set in the library', () => {
    for (const set of parameters.gwp_sets) {
      const co2e = toCarbonDioxideEquivalent(charcoal, set.id);
      expect(co2e.totalKg).toBeGreaterThan(0);
      expect(co2e.gwpSet.id).toBe(set.id);
    }
  });

  it('offers the AR6 set the calculator defaults to', () => {
    expect(parameters.gwp_sets.some((set) => set.id === AR6)).toBe(true);
  });

  it('throws rather than falling back when the set is unknown', () => {
    expect(() => toCarbonDioxideEquivalent(charcoal, 'gwp_not_a_set')).toThrow(EngineError);
    try {
      toCarbonDioxideEquivalent(charcoal, 'gwp_not_a_set');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_gwp_set');
    }
  });
});

describe('CO2-equivalent is never presented as IPCC-derived', () => {
  const co2e = toCarbonDioxideEquivalent(
    calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b'),
    AR6,
  );

  it('marks the set external and unverified', () => {
    // CLAUDE.md rule 4: the Guidelines publish no GWP table.
    expect(co2e.gwpSet.provenance).toBe('external');
    expect(co2e.gwpSet.verified).toBe(false);
  });

  it('carries the library note about the Guidelines publishing no GWPs', () => {
    expect(co2e.audit.libraryNote).toBe(parameters.gwp_sets_note);
    expect(co2e.audit.definition).toContain('publish no GWP table');
  });

  it('raises a caveat that the set has not been verified', () => {
    const gap = co2e.gaps.find((candidate) => candidate.parameterId === AR6);
    expect(gap?.message).toContain('not been verified');
  });

  it('gives every gas a GWP audit record naming its source', () => {
    for (const item of co2e.contributing) {
      expect(item.audit.gwp.provenance).toBe('external');
      expect(item.audit.gwp.source).toBeTruthy();
      expect(item.audit.gwp.role).toBe('global_warming_potential');
    }
  });
});

describe('uncertainty of the total', () => {
  const result = calculateFuelCombustion('liquefied_petroleum_gases', 150, '1A4b');
  const co2e = toCarbonDioxideEquivalent(result, AR6);

  it('applies Eq 3.2, not Eq 3.1', () => {
    expect(co2e.uncertainty.equation).toBe(parameters.uncertainty_convention.method_addition);
  });

  it('combines the gas contributions by the weighted formula', () => {
    // Recomputed here from the engine's own per-gas percentages, so this checks
    // the combination rather than restating it:
    //   U_total = sqrt(sum((Ui x xi)^2)) / sum(xi)
    const terms = co2e.contributing.map((item) => ({
      x: item.co2eKg,
      u: item.uncertaintyPercent ?? 0,
    }));
    const numerator = Math.sqrt(terms.reduce((total, t) => total + (t.u * t.x) ** 2, 0));
    const denominator = terms.reduce((total, t) => total + t.x, 0);

    expect(co2e.uncertainty.percent).toBeCloseTo(numerator / denominator, 12);
  });

  it('is dominated by CO2, which is 99.7 % of the total', () => {
    // 447.6945 of 448.9453485. Under Eq 3.2 the methane and nitrous oxide
    // percentages, large as they are, barely move the answer — so the total
    // should sit within a whisker of CO2's own figure.
    const carbonDioxide = entry(co2e.contributing, 'CO2');
    expect(co2e.uncertainty.percent).toBeCloseTo(carbonDioxide.uncertaintyPercent ?? 0, 1);
  });

  it('records that no GWP contributed an uncertainty term', () => {
    // A GWP with no published interval is not a GWP known to be exact
    // (CLAUDE.md rule 5).
    const gwpSkips = co2e.uncertainty.skipped.filter(
      (term) => term.role === 'global_warming_potential',
    );
    expect(gwpSkips).toHaveLength(co2e.contributing.length);
    for (const skip of gwpSkips) {
      expect(skip.reason).toBe('confidence_interval_not_published');
    }
    expect(co2e.uncertainty.incomplete).toBe(true);
  });

  it('carries forward the calorific value symmetrisation', () => {
    // The LPG NCV interval is asymmetric and was symmetrised in the Eq 3.1 step.
    // That simplification must still be visible on the total.
    expect(co2e.uncertainty.symmetrisedParameters).toContain('ncv_lpg');
  });
});

describe('zero mass', () => {
  const co2e = toCarbonDioxideEquivalent(
    calculateFuelCombustion('liquefied_petroleum_gases', 0, '1A4b'),
    AR6,
  );

  it('totals zero without dividing by zero', () => {
    expect(co2e.totalKg).toBe(0);
    expect(co2e.uncertainty.percent).toBeNull();
  });
});
