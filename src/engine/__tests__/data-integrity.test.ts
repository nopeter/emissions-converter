/**
 * Integrity of the parameter library itself.
 *
 * The engine now throws when a parameter it needs is missing, null or
 * ambiguous, which makes the library's completeness testable rather than
 * something a user discovers. These assertions are the enforceable half of
 * that: they check the library's internal consistency, and they check that
 * every fuel can actually be converted to energy.
 *
 * What is deliberately NOT asserted here is that every (fuel, category, gas)
 * combination has a factor. The 2006 Guidelines do not publish one for every
 * combination — there is no residential petrol factor and no road-transport
 * charcoal factor, and inventing either would break CLAUDE.md rule 7. Turning
 * that into an assertion needs a product decision about which combinations the
 * calculator offers; until then, the pinned list in `biomass-memo.test.ts`
 * records which pairs compute today, so losing one fails the suite.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import { findNetCalorificValue } from '../lookup';
import { EXPECTED_EMISSION_FACTOR_UNIT, EXPECTED_NCV_UNIT } from '../units';

const PROVENANCE_CLASSES = ['ipcc', 'external', 'assumed'];

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
