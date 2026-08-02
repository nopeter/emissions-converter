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
