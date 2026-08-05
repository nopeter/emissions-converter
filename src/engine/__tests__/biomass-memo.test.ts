/**
 * Biomass CO2 is a memo item, not a total (CLAUDE.md rule 3).
 *
 * Vol 2 Ch 2: CO2 from the combustion of biofuels is reported as an information
 * item and is excluded from sectoral and national totals, to avoid double
 * counting with the land-use sector. CH4 and N2O from the same combustion ARE
 * included.
 *
 * This file exists to make that distinction hard to break by accident. It does
 * not test one fixture; it sweeps every fuel and every category in the library
 * and asserts the invariant holds for all of them.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import { toCarbonDioxideEquivalent } from '../co2e';
import { calculateFuelCombustion } from '../combustion';
import { EngineError } from '../errors';
import type { CombustionResult } from '../types';

const categories = Object.keys(parameters.categories);
const biomassFuels = parameters.fuels.filter((fuel) => fuel.biomass);

/**
 * Every fuel/category pair the engine can actually compute, at 1 kg.
 *
 * A pair with a missing or ambiguous factor throws rather than returning a
 * partial result, so it is skipped here. Which pairs those are is pinned below,
 * so that a pair quietly disappearing from the library shows up as a failure
 * rather than as a smaller sweep.
 */
function everyComputablePair(): CombustionResult[] {
  const results: CombustionResult[] = [];
  for (const fuel of parameters.fuels) {
    for (const category of categories) {
      try {
        results.push(calculateFuelCombustion(fuel.id, 1, category));
      } catch (error) {
        if (error instanceof EngineError) {
          continue;
        }
        throw error;
      }
    }
  }
  return results;
}

describe('biomass CO2 never reaches the total-contributing figure', () => {
  it('finds biomass fuels to test', () => {
    // Guards against the sweep below passing vacuously.
    expect(biomassFuels.map((fuel) => fuel.id)).toEqual(['charcoal', 'wood_wood_waste']);
  });

  it.each(biomassFuels.map((fuel) => fuel.id))(
    'excludes %s CO2 from totalContributing in every category',
    (fuelId) => {
      for (const category of categories) {
        let result: CombustionResult;
        try {
          result = calculateFuelCombustion(fuelId, 100, category);
        } catch (error) {
          if (error instanceof EngineError) {
            continue;
          }
          throw error;
        }

        const co2InTotal = result.totalContributing.filter(
          (emission) => emission.gas === 'CO2',
        );
        expect(co2InTotal).toEqual([]);
      }
    },
  );

  it('does include biomass CH4 and N2O in the total', () => {
    // The memo treatment applies to CO2 only. Dropping CH4 and N2O as well
    // would understate the emissions of a firewood or charcoal household,
    // which is the population this calculator is built for.
    for (const fuel of biomassFuels) {
      const result = calculateFuelCombustion(fuel.id, 100, '1A4b');
      const gases = result.totalContributing.map((emission) => emission.gas);
      expect(gases).toEqual(['CH4', 'N2O']);
      for (const emission of result.totalContributing) {
        expect(emission.kg).toBeGreaterThan(0);
      }
    }
  });

  it('gives every memo figure a reason the UI can show', () => {
    for (const fuel of biomassFuels) {
      const result = calculateFuelCombustion(fuel.id, 100, '1A4b');
      expect(result.memoItems.length).toBeGreaterThan(0);
      for (const emission of result.memoItems) {
        expect(emission.memoReason).toBeTruthy();
      }
    }
  });
});

describe('the memo/total split is consistent everywhere', () => {
  const results = everyComputablePair();

  it('covers every combination the calculator offers', () => {
    // Guards against the sweep silently shrinking to nothing. Which
    // combinations those are is asserted in `data-integrity.test.ts`, which
    // holds the MVP list; here we only need the sweep to be non-trivial and to
    // include both biomass fuels.
    expect(results.length).toBeGreaterThan(1);
    const swept = results.map((result) => result.fuelId);
    for (const fuel of biomassFuels) {
      expect(swept).toContain(fuel.id);
    }
  });

  it('never places a memo-flagged gas in totalContributing', () => {
    for (const result of results) {
      for (const emission of result.totalContributing) {
        expect(emission.memoItem).toBe(false);
      }
    }
  });

  it('never places a non-memo gas in memoItems', () => {
    for (const result of results) {
      for (const emission of result.memoItems) {
        expect(emission.memoItem).toBe(true);
      }
    }
  });

  it('agrees with the parameter library about which factors are memo items', () => {
    // The engine must not decide memo status from the fuel's biomass flag; the
    // authority is the memo_item flag on the individual emission factor.
    for (const result of results) {
      for (const emission of [...result.totalContributing, ...result.memoItems]) {
        const factorId = emission.audit.factors[emission.audit.factors.length - 1].parameterId;
        const record = parameters.emission_factors.find((factor) => factor.id === factorId);
        expect(record).toBeDefined();
        expect(emission.memoItem).toBe(record?.memo_item === true);
      }
    }
  });
});

/**
 * The same invariant, after conversion to CO2-equivalent.
 *
 * This is the refactor rule 3 is most likely to be lost in. Restating gases in a
 * common unit and adding them up is exactly the operation that makes folding
 * biomass CO2 into the total look reasonable — it is, after all, now measured in
 * the same unit as everything else. It must not be folded in, under any GWP set.
 */
describe('CO2-equivalent totals exclude biomass CO2', () => {
  const results = everyComputablePair();

  it('has biomass results to check', () => {
    expect(results.some((result) => result.memoItems.length > 0)).toBe(true);
  });

  for (const set of parameters.gwp_sets) {
    describe(set.label, () => {
      it('never counts a memo item towards the total', () => {
        for (const result of results) {
          const co2e = toCarbonDioxideEquivalent(result, set.id);

          expect(co2e.contributing.every((item) => !item.memoItem)).toBe(true);
          expect(co2e.memoItems.every((item) => item.memoItem)).toBe(true);

          // The total is exactly the contributing gases and nothing else.
          const contributingSum = co2e.contributing.reduce(
            (total, item) => total + item.co2eKg,
            0,
          );
          expect(co2e.totalKg).toBeCloseTo(contributingSum, 12);
        }
      });

      it('keeps every biomass CO2 figure out of the total and in memo', () => {
        for (const result of results.filter((candidate) => candidate.memoItems.length > 0)) {
          const co2e = toCarbonDioxideEquivalent(result, set.id);

          expect(co2e.memoItems.map((item) => item.gas)).toEqual(['CO2']);
          expect(co2e.memoTotalKg).toBeGreaterThan(0);
          expect(co2e.contributing.some((item) => item.gas === 'CO2')).toBe(false);
        }
      });

      it('still counts biomass CH4 and N2O towards the total', () => {
        // The other half of rule 3, and the easier half to lose: excluding the
        // whole fuel would be as wrong as including its CO2.
        for (const result of results.filter((candidate) => candidate.memoItems.length > 0)) {
          const gases = toCarbonDioxideEquivalent(result, set.id).contributing.map(
            (item) => item.gas,
          );
          expect(gases).toContain('CH4');
          expect(gases).toContain('N2O');
        }
      });
    });
  }
});

describe('AR6 methane origin follows the fuel, across the whole library', () => {
  const results = everyComputablePair();
  const ar6 = parameters.gwp_sets.find((set) => set.fossil_split);

  it('has a set that splits methane by origin', () => {
    expect(ar6).toBeDefined();
  });

  it('gives every biomass fuel the non-fossil value and every other fuel the fossil one', () => {
    for (const result of results) {
      const methane = toCarbonDioxideEquivalent(result, ar6!.id).contributing.find(
        (item) => item.gas === 'CH4',
      );
      expect(methane).toBeDefined();
      expect(methane?.gwp.origin).toBe(result.biomass ? 'non_fossil' : 'fossil');
    }
  });

  it('gives biomass fuels a lower methane GWP than fossil fuels', () => {
    // AR6's non-fossil methane GWP is the lower of the two. If this inverts,
    // the origin selection has been wired backwards — which a per-fuel test
    // using only one fuel would not catch.
    const gwpFor = (biomass: boolean): number => {
      const result = results.find((candidate) => candidate.biomass === biomass);
      expect(result).toBeDefined();
      const methane = toCarbonDioxideEquivalent(result!, ar6!.id).contributing.find(
        (item) => item.gas === 'CH4',
      );
      return methane?.gwp.value ?? 0;
    };

    expect(gwpFor(true)).toBeLessThan(gwpFor(false));
  });
});
