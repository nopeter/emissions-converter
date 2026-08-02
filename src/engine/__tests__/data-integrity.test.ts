/**
 * Integrity of the parameter library itself.
 *
 * The engine throws when a parameter it needs is missing, null or ambiguous,
 * which makes the library's completeness testable rather than something a user
 * discovers. This file is where that gets enforced: the calculator's offered
 * combinations must have a complete factor set, and everything else must be
 * wholly absent rather than half-built.
 *
 * The 2006 Guidelines do not publish a factor for every combination, and never
 * will — there is no residential petrol factor and no road-transport charcoal
 * factor. That is why the assertion below is "complete or empty", not
 * "complete everywhere". Filling a hole to satisfy a test would break
 * CLAUDE.md rule 7.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import type { CategoryCode } from '../../data/types';
import { calculateFuelCombustion } from '../combustion';
import { findEmissionFactors, findNetCalorificValue, GASES } from '../lookup';
import { EXPECTED_EMISSION_FACTOR_UNIT, EXPECTED_NCV_UNIT } from '../units';

const PROVENANCE_CLASSES = ['ipcc', 'external', 'assumed'];

/**
 * The fuel/category combinations the MVP calculator offers.
 *
 * A combination qualifies when the library publishes a complete, unambiguous
 * factor set for it: CO2, CH4 and N2O, one factor each. This list is the
 * product decision; the tests below hold the library to it.
 */
const MVP_COMBINATIONS: ReadonlyArray<readonly [string, CategoryCode]> = [
  ['liquefied_petroleum_gases', '1A4b'],
  ['liquefied_petroleum_gases', '1A3b'],
  ['charcoal', '1A4b'],
  ['wood_wood_waste', '1A4b'],
  ['other_kerosene', '1A4b'],
  ['gas_diesel_oil', '1A3b'],
  ['natural_gas', '1A4b'],
];

const isMvp = (fuelId: string, category: CategoryCode): boolean =>
  MVP_COMBINATIONS.some(([fuel, code]) => fuel === fuelId && code === category);

/** Every fuel/category pair in the library, offered or not. */
function everyCombination(): Array<readonly [string, CategoryCode]> {
  const pairs: Array<readonly [string, CategoryCode]> = [];
  for (const fuel of parameters.fuels) {
    for (const category of Object.keys(parameters.categories)) {
      pairs.push([fuel.id, category]);
    }
  }
  return pairs;
}

describe('every fuel can be converted to energy', () => {
  it.each(parameters.fuels.map((fuel) => fuel.id))('%s has a net calorific value', (fuelId) => {
    const ncv = findNetCalorificValue(parameters, fuelId);
    expect(ncv).toBeDefined();
    expect(Number.isFinite(ncv?.value)).toBe(true);
    expect(ncv?.value).toBeGreaterThan(0);
  });

  it('publishes every calorific value in the unit the engine applies', () => {
    for (const ncv of parameters.net_calorific_values) {
      expect(ncv.unit).toBe(EXPECTED_NCV_UNIT);
    }
  });

  it('has no calorific value for a fuel that does not exist', () => {
    const fuelIds = new Set(parameters.fuels.map((fuel) => fuel.id));
    for (const ncv of parameters.net_calorific_values) {
      expect(fuelIds.has(ncv.fuel)).toBe(true);
    }
  });
});

describe('every offered combination has a complete factor set', () => {
  it.each(MVP_COMBINATIONS)('%s / %s publishes CO2, CH4 and N2O', (fuelId, category) => {
    // The calculator offers this combination, so all three gases must be
    // available. If this fails, either the library lost a factor or the
    // combination should not be on the MVP list — do not invent the factor.
    for (const gas of GASES) {
      const matches = findEmissionFactors(parameters, fuelId, category, gas);
      expect(
        matches.length,
        `${fuelId} / ${category}: no ${gas} emission factor in the parameter library`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(MVP_COMBINATIONS)('%s / %s publishes non-null values', (fuelId, category) => {
    for (const gas of GASES) {
      for (const factor of findEmissionFactors(parameters, fuelId, category, gas)) {
        expect(
          Number.isFinite(factor.value),
          `${factor.id}: value is ${JSON.stringify(factor.value)}`,
        ).toBe(true);
      }
    }
  });

  it.each(MVP_COMBINATIONS)('%s / %s resolves to exactly one factor per gas', (fuelId, category) => {
    // An offered combination must be unambiguous as well as complete: the
    // engine throws on more than one match, so a second factor would take the
    // combination out of service without removing it from the MVP list.
    for (const gas of GASES) {
      expect(findEmissionFactors(parameters, fuelId, category, gas)).toHaveLength(1);
    }
  });

  it.each(MVP_COMBINATIONS)('%s / %s calculates without throwing', (fuelId, category) => {
    // The end-to-end consequence of the three assertions above.
    expect(() => calculateFuelCombustion(fuelId, 1, category)).not.toThrow();
  });

  it('offers every combination that is complete and unambiguous', () => {
    // The other direction: a combination the library fully supports should not
    // be missing from the MVP list by oversight.
    //
    // motor_gasoline / 1A3b is the one deliberate exclusion. Its factor set is
    // complete, but Table 3.2.2 disaggregates CH4 and N2O by vehicle
    // technology, so it needs a Tier 3 choice from the user before it can be
    // calculated. It is excluded here, not missing.
    const unambiguouslyComplete = everyCombination().filter(([fuelId, category]) =>
      GASES.every((gas) => findEmissionFactors(parameters, fuelId, category, gas).length === 1),
    );

    expect(unambiguouslyComplete.filter(([f, c]) => !isMvp(f, c))).toEqual([]);
    expect(unambiguouslyComplete).toHaveLength(MVP_COMBINATIONS.length);
  });
});

describe('combinations outside the MVP are complete or empty, never partial', () => {
  // A partial factor set is the dangerous state: it looks like support, and
  // under the old gap-returning engine it would have produced a result missing
  // a gas. A wholly absent set is fine — it means the Guidelines publish
  // nothing for that combination, or that work has not started.
  //
  // A missing density is also fine. It blocks volume-based input for a fuel,
  // which is a separate, already-visible gap; it says nothing about whether the
  // emission factors for that fuel are coherent.
  const nonMvp = everyCombination().filter(([fuelId, category]) => !isMvp(fuelId, category));

  it('has combinations to check', () => {
    expect(nonMvp.length).toBeGreaterThan(0);
  });

  it.each(nonMvp)('%s / %s has all three gases or none', (fuelId, category) => {
    const present = GASES.filter(
      (gas) => findEmissionFactors(parameters, fuelId, category, gas).length > 0,
    );

    expect(
      present.length === 0 || present.length === GASES.length,
      `${fuelId} / ${category} has a partial factor set: ${present.join(', ') || 'none'} ` +
        `present, ${GASES.filter((gas) => !present.includes(gas)).join(', ')} missing. ` +
        `Publish the missing gases or remove the partial set — do not ship half a fuel.`,
    ).toBe(true);
  });

  it.each(nonMvp)('%s / %s publishes non-null values for whatever it does have', (fuelId, category) => {
    for (const gas of GASES) {
      for (const factor of findEmissionFactors(parameters, fuelId, category, gas)) {
        expect(
          Number.isFinite(factor.value),
          `${factor.id}: value is ${JSON.stringify(factor.value)}`,
        ).toBe(true);
      }
    }
  });

  it('does not treat a missing density as a factor problem', () => {
    // Every density in the library is currently unsourced, yet the fuels they
    // block still have coherent factor sets. The two gaps are independent.
    const blockedFuels = parameters.fuels
      .filter((fuel) => fuel.blocked_by !== undefined)
      .map((fuel) => fuel.id);
    expect(blockedFuels.length).toBeGreaterThan(0);

    for (const fuelId of blockedFuels) {
      for (const category of Object.keys(parameters.categories)) {
        const present = GASES.filter(
          (gas) => findEmissionFactors(parameters, fuelId, category, gas).length > 0,
        );
        expect(present.length === 0 || present.length === GASES.length).toBe(true);
      }
    }
  });
});

describe('every emission factor is well formed', () => {
  const fuelIds = new Set(parameters.fuels.map((fuel) => fuel.id));
  const categoryCodes = new Set(Object.keys(parameters.categories));

  it('references a known fuel and a known category', () => {
    for (const factor of parameters.emission_factors) {
      expect(fuelIds.has(factor.fuel)).toBe(true);
      expect(categoryCodes.has(factor.category)).toBe(true);
    }
  });

  it('carries a finite value in kg/TJ', () => {
    for (const factor of parameters.emission_factors) {
      expect(Number.isFinite(factor.value)).toBe(true);
      expect(factor.value).toBeGreaterThan(0);
      expect(factor.unit).toBe(EXPECTED_EMISSION_FACTOR_UNIT);
    }
  });

  it('has a unique id', () => {
    const ids = parameters.emission_factors.map((factor) => factor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names a source and declares a provenance class', () => {
    for (const factor of parameters.emission_factors) {
      expect(PROVENANCE_CLASSES).toContain(factor.provenance);
      expect(factor.source).toBeTruthy();
    }
  });

  it('publishes both confidence bounds or neither', () => {
    // A half-published interval would be silently mishandled: the engine skips a
    // term when either bound is null, so a stray single bound would look like a
    // published range that never gets used.
    for (const factor of parameters.emission_factors) {
      expect(factor.ci95_low === null).toBe(factor.ci95_high === null);
    }
  });

  it('publishes intervals that bracket their central value', () => {
    for (const factor of parameters.emission_factors) {
      if (factor.ci95_low === null || factor.ci95_high === null) {
        continue;
      }
      expect(factor.ci95_low).toBeLessThanOrEqual(factor.value);
      expect(factor.ci95_high).toBeGreaterThanOrEqual(factor.value);
    }
  });
});

describe('memo flags are on the right records', () => {
  const biomassFuels = new Set(
    parameters.fuels.filter((fuel) => fuel.biomass).map((fuel) => fuel.id),
  );

  it('marks only biomass CO2 as a memo item', () => {
    // Vol 2 Ch 2. A memo flag on a fossil factor would drop real emissions from
    // the total; a memo flag on biomass CH4 or N2O would do the same.
    for (const factor of parameters.emission_factors) {
      if (factor.memo_item === true) {
        expect(factor.gas).toBe('CO2');
        expect(biomassFuels.has(factor.fuel)).toBe(true);
      }
    }
  });

  it('marks every biomass CO2 factor as a memo item, with a reason', () => {
    const biomassCo2 = parameters.emission_factors.filter(
      (factor) => factor.gas === 'CO2' && biomassFuels.has(factor.fuel),
    );
    expect(biomassCo2.length).toBeGreaterThan(0);
    for (const factor of biomassCo2) {
      expect(factor.memo_item).toBe(true);
      expect(factor.memo_reason).toBeTruthy();
    }
  });
});

describe('provenance is declared everywhere', () => {
  it('gives every calorific value a class and a source', () => {
    for (const ncv of parameters.net_calorific_values) {
      expect(PROVENANCE_CLASSES).toContain(ncv.provenance);
      expect(ncv.source).toBeTruthy();
    }
  });

  it('never labels a GWP set as IPCC-derived', () => {
    // The 2006 Guidelines reference GWPs but publish no table, so every GWP set
    // is external to the methodology (CLAUDE.md rule 4).
    for (const set of parameters.gwp_sets) {
      expect(set.provenance).toBe('external');
    }
  });

  it('leaves unsourced parameters null rather than filled in', () => {
    for (const density of parameters.densities) {
      if (density.status === 'unsourced') {
        expect(density.value).toBeNull();
        expect(density.source).toBeNull();
        expect(density.verified).toBe(false);
      }
    }
  });
});
