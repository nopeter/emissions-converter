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
import type { CategoryCode, Gas, UnitMeasure } from '../../data/types';
import { calculateFuelCombustion } from '../combustion';
import { CANONICAL_UNITS, convertQuantity, findUnit } from '../conversion';
import { findEmissionFactors, findNetCalorificValue, GASES } from '../lookup';
import { EXPECTED_EMISSION_FACTOR_UNIT, EXPECTED_NCV_UNIT } from '../units';

const PROVENANCE_CLASSES = ['ipcc', 'external', 'assumed'];
const CONVERSION_PROVENANCE_CLASSES = ['exact', 'ipcc_approximate', 'user_provided'];

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

describe('every unit is well formed', () => {
  it('publishes units to check', () => {
    expect(parameters.units.length).toBeGreaterThan(0);
  });

  it('has a unique id', () => {
    const ids = parameters.units.map((unit) => unit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries a finite positive factor, a symbol, a source and a class', () => {
    for (const unit of parameters.units) {
      expect(Number.isFinite(unit.factor), `${unit.id}: factor is not finite`).toBe(true);
      expect(unit.factor).toBeGreaterThan(0);
      expect(unit.symbol).toBeTruthy();
      expect(unit.source).toBeTruthy();
      expect(CONVERSION_PROVENANCE_CLASSES).toContain(unit.provenance);
    }
  });

  it('declares every unit conversion exact, because every one is a definition', () => {
    // Nothing in this table was measured. If a unit ever needs a class other
    // than `exact`, it is not a unit conversion and does not belong here.
    for (const unit of parameters.units) {
      expect(unit.provenance, `${unit.id}`).toBe('exact');
      expect(unit.verified, `${unit.id}`).toBe(true);
    }
  });

  it('converts each unit to the canonical unit for what it measures', () => {
    // A unit that named the wrong canonical would be out by orders of
    // magnitude and would still look plausible in the audit trail.
    for (const unit of parameters.units) {
      expect(unit.canonical_unit, `${unit.id}`).toBe(CANONICAL_UNITS[unit.measures]);
    }
  });

  it('never publishes two units of the same kind with a factor of 1', () => {
    // Two identity units for the same kind of quantity would mean two names for
    // the same thing, and the audit trail would say which was used only by id.
    //
    // Zero is allowed, and energy has zero on purpose: the canonical energy
    // unit is the terajoule, which nobody's gas bill is denominated in, so it
    // is not offered. A canonical unit is what the engine reduces to, not
    // something a user has to be able to type.
    const measures: UnitMeasure[] = ['mass', 'volume', 'energy', 'density'];

    for (const measure of measures) {
      const identity = parameters.units.filter(
        (unit) => unit.measures === measure && unit.factor === 1,
      );
      expect(identity.length, `${measure}: more than one unit with factor 1`).toBeLessThanOrEqual(
        1,
      );
      for (const unit of identity) {
        expect(unit.canonical_unit).toBe(CANONICAL_UNITS[measure]);
      }
    }
  });

  it('offers no gallons and no therms', () => {
    // Both have more than one definition in live use, and the difference is
    // large enough to change an answer materially.
    const ids = parameters.units.map((unit) => unit.id.toLowerCase());
    expect(ids.some((id) => id.includes('gallon'))).toBe(false);
    expect(ids.some((id) => id.includes('therm'))).toBe(false);
  });
});

describe('every fuel can be entered in the unit it is sold in', () => {
  it.each(parameters.fuels.map((fuel) => fuel.id))('%s names a default unit that exists', (fuelId) => {
    const fuel = parameters.fuels.find((candidate) => candidate.id === fuelId);
    const unit = findUnit(parameters, fuel?.default_unit ?? '');
    expect(unit, `${fuelId}: default_unit "${fuel?.default_unit}" is not in units`).toBeDefined();
    expect(unit?.measures).not.toBe('density');
  });

  it.each(parameters.fuels.map((fuel) => fuel.id))('%s can be calculated in its default unit', (fuelId) => {
    // The end-to-end consequence: whatever unit a fuel is preselected in, the
    // conversion layer must accept it, given the answers that unit requires.
    const fuel = parameters.fuels.find((candidate) => candidate.id === fuelId);
    const unit = findUnit(parameters, fuel?.default_unit ?? '');

    const extras =
      unit?.measures === 'volume'
        ? { density: { value: 1, unit: 'kg_per_litre' } }
        : unit?.measures === 'energy'
          ? { calorificBasis: 'net' as const }
          : {};

    expect(() =>
      convertQuantity(fuelId, { quantity: 1, unit: fuel?.default_unit ?? '', ...extras }),
    ).not.toThrow();
  });

  it('defaults a fuel to a volume unit only where a density record exists to prompt from', () => {
    for (const fuel of parameters.fuels) {
      const unit = findUnit(parameters, fuel.default_unit);
      if (unit?.measures !== 'volume') {
        continue;
      }
      const density = parameters.densities.find((record) => record.fuel === fuel.id);
      expect(density, `${fuel.id}: defaults to a volume but has no density record`).toBeDefined();
    }
  });

  it('gives every density record a unit that is a unit of density', () => {
    for (const density of parameters.densities) {
      const unit = findUnit(parameters, density.unit);
      expect(unit, `${density.id}: unit "${density.unit}" is not in units`).toBeDefined();
      expect(unit?.measures).toBe('density');
    }
  });
});

describe('purchase presets are assumptions and say so', () => {
  const presets = parameters.fuels.flatMap((fuel) =>
    (fuel.presets ?? []).map((preset) => ({ fuel: fuel.id, preset })),
  );

  it('publishes presets to check', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it('marks every preset as assumed, never as sourced', () => {
    // A 12.5 kg cylinder is named for what it holds when full. The preset is an
    // assumption about the user's cylinder, not a measurement of it, and must
    // never be presented as IPCC-derived (CLAUDE.md rule 2).
    for (const { fuel, preset } of presets) {
      expect(preset.provenance, `${fuel}/${preset.id}`).toBe('assumed');
      expect(preset.verified).toBe(false);
      expect(preset.source).toBeNull();
      expect(preset.note, `${fuel}/${preset.id}: needs to say what it assumes`).toBeTruthy();
    }
  });

  it('gives every preset a positive quantity in a unit that exists', () => {
    for (const { fuel, preset } of presets) {
      expect(preset.quantity, `${fuel}/${preset.id}`).toBeGreaterThan(0);
      expect(findUnit(parameters, preset.unit), `${fuel}/${preset.id}`).toBeDefined();
    }
  });

  it('gives every preset a unique id', () => {
    const ids = presets.map(({ preset }) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the gross-to-net rules of thumb are complete and honest', () => {
  it('publishes one conversion per family, and no family twice', () => {
    const families = parameters.calorific_basis_conversions.map(
      (conversion) => conversion.fuel_family,
    );
    expect(families.length).toBeGreaterThan(0);
    expect(new Set(families).size).toBe(families.length);
  });

  it('classes every one as an IPCC approximation, and none as verified', () => {
    // These are rules of thumb quoted from Vol 2 Ch 1, cited at chapter level.
    // Marking one `exact` would claim the Guidelines quantify it; marking one
    // verified would claim the exact section has been confirmed.
    for (const conversion of parameters.calorific_basis_conversions) {
      expect(conversion.provenance, conversion.id).toBe('ipcc_approximate');
      expect(conversion.verified, conversion.id).toBe(false);
      expect(conversion.source).toBeTruthy();
      expect(conversion.note, `${conversion.id}: must name the Box 1.1 alternative`).toContain(
        'Box 1.1',
      );
    }
  });

  it('reduces by a sensible percentage, never increases and never zeroes', () => {
    for (const conversion of parameters.calorific_basis_conversions) {
      expect(conversion.reduction_percent, conversion.id).toBeGreaterThan(0);
      expect(conversion.reduction_percent, conversion.id).toBeLessThan(100);
    }
  });

  it('gives every fuel that names a family a conversion to match it', () => {
    // A fuel naming a family with no record would fail only at the moment a
    // user entered a gross figure for it, which is the wrong time to find out.
    const families = new Set(
      parameters.calorific_basis_conversions.map((conversion) => conversion.fuel_family),
    );

    for (const fuel of parameters.fuels) {
      if (fuel.calorific_basis_family === undefined) {
        continue;
      }
      expect(families.has(fuel.calorific_basis_family), `${fuel.id}`).toBe(true);
    }
  });

  it('gives no biomass fuel a family, because none is published for solid biomass', () => {
    // Moisture content drives the gross-to-net difference for wood and
    // charcoal, and it is both larger and more variable than either rule of
    // thumb. Assigning one would be inventing a factor (CLAUDE.md rule 7).
    for (const fuel of parameters.fuels.filter((candidate) => candidate.biomass)) {
      expect(fuel.calorific_basis_family, `${fuel.id}`).toBeUndefined();
    }
  });

  it('explains any family assignment that is not obvious from the fuel name', () => {
    // LPG is the live case: a gas at ambient pressure, but classified by Table
    // 1.1 as a liquid fuel, so it takes the coal-and-oil rule.
    const lpg = parameters.fuels.find((fuel) => fuel.id === 'liquefied_petroleum_gases');
    expect(lpg?.calorific_basis_family).toBe('coal_and_oil');
    expect(lpg?.calorific_basis_family_note).toBeTruthy();
  });
});

describe('every GWP set is well formed', () => {
  const gwpValues = (setId: string, gas: Gas) => {
    const set = parameters.gwp_sets.find((candidate) => candidate.id === setId);
    return (set?.values ?? []).filter((value) => value.gas === gas);
  };

  it('publishes GWP sets to check', () => {
    expect(parameters.gwp_sets.length).toBeGreaterThan(0);
  });

  it.each(parameters.gwp_sets.map((set) => set.id))('%s defines CO2 as exactly 1', (setId) => {
    // CO2-equivalent is expressed in CO2, so CO2 is 1 by definition of the
    // unit, in every set and every horizon. A set that says otherwise is
    // mistranscribed, and every headline total computed from it would be wrong.
    const co2 = gwpValues(setId, 'CO2');
    expect(co2).toHaveLength(1);
    expect(co2[0]?.value).toBe(1);
  });

  it.each(parameters.gwp_sets.map((set) => set.id))('%s covers all three gases', (setId) => {
    for (const gas of GASES) {
      expect(gwpValues(setId, gas).length).toBeGreaterThan(0);
    }
  });

  it.each(parameters.gwp_sets.map((set) => set.id))(
    '%s splits methane by origin if and only if it says it does',
    (setId) => {
      // AR6 publishes a higher 100-year GWP for fossil methane than for
      // non-fossil methane. A set that claims the split must actually carry both
      // values, or a consumer choosing by fuel origin would silently find
      // nothing; a set that does not claim it must carry exactly one, or a
      // consumer would silently pick whichever came first in the file.
      const set = parameters.gwp_sets.find((candidate) => candidate.id === setId);
      const methane = gwpValues(setId, 'CH4');
      const origins = methane.map((value) => value.origin).sort();

      if (set?.fossil_split === true) {
        expect(
          origins,
          `${setId}: fossil_split is true, so it needs one fossil and one non-fossil CH4 value`,
        ).toEqual(['fossil', 'non_fossil']);
      } else {
        expect(
          methane,
          `${setId}: fossil_split is false, so it needs exactly one CH4 value`,
        ).toHaveLength(1);
        expect(methane[0]?.origin).toBe('all');
      }
    },
  );

  it('declares fossil_split on every set', () => {
    // Absent must not be readable as false. The flag decides whether a consumer
    // has to ask about fuel origin at all.
    for (const set of parameters.gwp_sets) {
      expect(typeof set.fossil_split).toBe('boolean');
    }
  });

  it('carries a finite positive value on every GWP', () => {
    for (const set of parameters.gwp_sets) {
      for (const value of set.values) {
        expect(Number.isFinite(value.value)).toBe(true);
        expect(value.value).toBeGreaterThan(0);
      }
    }
  });

  it('gives every GWP set and value a unique id', () => {
    const setIds = parameters.gwp_sets.map((set) => set.id);
    expect(new Set(setIds).size).toBe(setIds.length);

    const valueIds = parameters.gwp_sets.flatMap((set) => set.values.map((value) => value.id));
    expect(new Set(valueIds).size).toBe(valueIds.length);
  });

  it('names a source and a note on every set, and is not marked verified', () => {
    // The sources name a report and a year but not yet a table, so nothing here
    // has been checked against a primary source.
    for (const set of parameters.gwp_sets) {
      expect(set.source).toBeTruthy();
      expect(set.note).toBeTruthy();
      if (set.source_precision === 'report_level') {
        expect(set.verified).toBe(false);
      }
    }
  });

  it('records at library level that the Guidelines publish no GWP table', () => {
    expect(parameters.gwp_sets_note).toBeTruthy();
  });
});
