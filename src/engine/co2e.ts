/**
 * CO2-equivalent: the derived view.
 *
 * This module restates a `CombustionResult`'s gases in a single unit and adds
 * them up. It is deliberately a separate function over a finished result rather
 * than a field inside it, because that is the order CLAUDE.md rule 4 requires:
 * kg CO2, kg CH4 and kg N2O are the primary result, and CO2-equivalent is a
 * view over them. A caller who never asks for this view still gets a complete,
 * correct answer.
 *
 * Three things about that view are not conveniences and must survive a refactor:
 *
 *  - **Biomass CO2 stays out of the total.** Vol 2 Ch 2 reports it as an
 *    information item, excluded from sectoral and national totals to avoid
 *    double counting. Converting it into CO2-equivalent does not change what it
 *    is, so it lands in `memoItems` and `totalKg` never includes it. The CH4 and
 *    N2O from the same combustion do count, and do.
 *  - **The GWP set is named, and is the caller's choice.** The 2006 Guidelines
 *    publish no GWP table; every set is `external`. Which set produced a number
 *    travels with the number, in `gwpSet` and in every `GwpSelection`.
 *  - **A GWP is not an exact number just because no range is published.** AR6
 *    and its predecessors publish no confidence interval in this library, so the
 *    multiplication contributes no Eq 3.1 term. The omission is recorded in
 *    `uncertainty.skipped`, which is what makes the combined figure read as a
 *    lower bound rather than a complete one.
 *
 * Pure, like the rest of the engine: no React, no DOM, no I/O. Every number it
 * uses comes from the parameter library.
 */
import { parameters } from '../data';
import type { Gas, GwpOrigin, GwpSet, GwpValue, ParameterLibrary } from '../data/types';
import { EngineError } from './errors';
import { formatNumber } from './format';
import { findGwpSet, findGwpValues } from './lookup';
import type {
  CarbonDioxideEquivalentAudit,
  CarbonDioxideEquivalentResult,
  CombustionResult,
  FactorAudit,
  GasCarbonDioxideEquivalent,
  GasEmission,
  GwpSelection,
  GwpSetAudit,
  ParameterGap,
  SkippedUncertaintyTerm,
} from './types';
import { combineAdditive, type AdditiveCandidate } from './uncertainty';

/**
 * Restate a combustion result in CO2-equivalent and total it.
 *
 * @param result  a finished combustion result; its gas figures are not recomputed
 * @param gwpSetId  a GWP set id from the parameter library, e.g. "gwp_ar6_100"
 *
 * @throws {EngineError} if the GWP set is unknown, publishes no value for a gas
 * the result contains, or publishes several without the fuel settling which
 * applies.
 */
export function toCarbonDioxideEquivalent(
  result: CombustionResult,
  gwpSetId: string,
  library: ParameterLibrary = parameters,
): CarbonDioxideEquivalentResult {
  const set = findGwpSet(library, gwpSetId);
  if (!set) {
    throw new EngineError(
      'unknown_gwp_set',
      `No GWP set with id "${gwpSetId}" exists in the parameter library. Known sets: ` +
        `${library.gwp_sets.map((candidate) => candidate.id).join(', ')}.`,
    );
  }

  const convert = (emission: GasEmission): GasCarbonDioxideEquivalent =>
    applyGwp(emission, set, result.biomass);

  const contributing = result.totalContributing.map(convert);
  const memoItems = result.memoItems.map(convert);

  const totalKg = sum(contributing.map((entry) => entry.co2eKg));
  const memoTotalKg = sum(memoItems.map((entry) => entry.co2eKg));

  // Every GWP applied is an Eq 3.1 term that could not be included, one per
  // gas. Recorded here rather than swallowed: "no published range" and "no
  // uncertainty" are opposite claims (CLAUDE.md rule 5).
  const gwpOmissions: SkippedUncertaintyTerm[] = contributing.map((entry) => ({
    parameterId: entry.gwp.valueId,
    role: 'global_warming_potential',
    label: `${entry.gwp.valueLabel} (${entry.gwp.setLabel})`,
    reason: 'confidence_interval_not_published',
    note:
      `No confidence interval is published for the ${entry.gwp.valueLabel.toLowerCase()} GWP in ` +
      `${entry.gwp.setLabel}, so multiplying by it added no term to the combination. The ` +
      `uncertainty shown is that of the gas figures alone and is a lower bound.`,
  }));

  const candidates: AdditiveCandidate[] = contributing.map((entry) => ({
    parameterId: entry.gwp.valueId,
    role: 'global_warming_potential',
    label: `${entry.gas} contribution to the total`,
    value: entry.co2eKg,
    percent: entry.uncertaintyPercent,
    missingNote:
      `The ${entry.gas} figure carries no quantified uncertainty, so its contribution to the ` +
      `total was left out of the Eq 3.2 combination rather than treated as exact.`,
  }));

  const uncertainty = combineAdditive(
    candidates,
    library.uncertainty_convention.method_addition,
    gwpOmissions,
    [...new Set(result.totalContributing.flatMap((gas) => gas.uncertainty.symmetrisedParameters))],
  );

  const audit: CarbonDioxideEquivalentAudit = {
    definition:
      `CO2-eq (kg) = Emission (kg) x GWP (kg CO2-eq per kg gas, ` +
      `${formatNumber(set.horizon_years)}-year horizon). Not an equation of the 2006 IPCC ` +
      `Guidelines: they publish no GWP table, so the set below is external to the methodology ` +
      `and is named with every figure derived from it.`,
    additionEquation: library.uncertainty_convention.method_addition,
    workings: totalWorkings(contributing, totalKg),
    libraryNote: library.gwp_sets_note,
  };

  return {
    gwpSet: describeSet(set),
    contributing,
    memoItems,
    totalKg,
    memoTotalKg,
    uncertainty,
    gaps: setGaps(set, memoItems),
    audit,
  };
}

/** Apply one GWP to one gas. */
function applyGwp(
  emission: GasEmission,
  set: GwpSet,
  biomass: boolean,
): GasCarbonDioxideEquivalent {
  const gwp = selectGwp(emission.gas, set, biomass);
  const co2eKg = emission.kg * gwp.value;

  return {
    gas: emission.gas,
    kg: emission.kg,
    gwp,
    co2eKg,
    memoItem: emission.memoItem,
    memoReason: emission.memoReason,
    uncertaintyPercent: emission.uncertainty.percent,
    audit: {
      equation:
        `CO2-eq (kg) = ${emission.gas} (kg) x GWP over ` +
        `${formatNumber(set.horizon_years)} years, from ${set.label}`,
      workings:
        `${formatNumber(emission.kg)} kg ${emission.gas} x ${formatNumber(gwp.value)} = ` +
        `${formatNumber(co2eKg)} kg CO2-eq`,
      gwp: gwpAudit(gwp, set),
    },
  };
}

/**
 * Choose the GWP that applies to a gas, given what was burned.
 *
 * One published value is the ordinary case. Where a set publishes two — AR6's
 * fossil and non-fossil methane — the fuel decides: methane from wood or
 * charcoal is biogenic, so the non-fossil value applies to it and the fossil
 * value to everything else. That is a fact about the fuel, not a preference,
 * which is why it is settled here rather than asked of the user.
 */
function selectGwp(gas: Gas, set: GwpSet, biomass: boolean): GwpSelection {
  const candidates = findGwpValues(set, gas);

  if (candidates.length === 0) {
    throw new EngineError(
      'missing_gwp_value',
      `${set.label} publishes no ${gas} global warming potential in the parameter library, so ` +
        `${gas} cannot be expressed in CO2-equivalent. The engine will not estimate one, and ` +
        `will not leave ${gas} out of a total that claims to include it.`,
    );
  }

  const describe = (value: GwpValue, originReason: string): GwpSelection => ({
    setId: set.id,
    setLabel: set.label,
    horizonYears: set.horizon_years,
    valueId: value.id,
    valueLabel: value.label,
    gas: value.gas,
    origin: value.origin,
    value: value.value,
    originReason,
  });

  if (candidates.length === 1) {
    return describe(
      candidates[0],
      `${set.label} publishes a single ${gas} value, applying to every source.`,
    );
  }

  const origin: GwpOrigin = biomass ? 'non_fossil' : 'fossil';
  const match = candidates.find((value) => value.origin === origin);

  if (!match) {
    throw new EngineError(
      'ambiguous_gwp_value',
      `${set.label} publishes ${candidates.length} ${gas} global warming potentials ` +
        `(${candidates.map((value) => value.origin).join(', ')}), and none of them is the ` +
        `"${origin}" value this fuel needs. Choosing between them by anything other than the ` +
        `origin of the fuel would misstate the result.`,
    );
  }

  return describe(
    match,
    biomass
      ? `${set.label} splits ${gas} by origin. This fuel is biomass, so the carbon in it is ` +
          `biogenic and the non-fossil value applies.`
      : `${set.label} splits ${gas} by origin. This fuel is a fossil fuel, so the fossil ` +
          `value applies.`,
  );
}

function gwpAudit(gwp: GwpSelection, set: GwpSet): FactorAudit {
  return {
    parameterId: gwp.valueId,
    role: 'global_warming_potential',
    label: `${gwp.valueLabel}, ${formatNumber(gwp.horizonYears)}-year GWP`,
    value: gwp.value,
    unit: 'kg CO2-eq/kg',
    provenance: set.provenance,
    source: set.source,
    verified: set.verified,
    // No GWP set in the library publishes a confidence interval. Left null
    // rather than filled in: the uncertainty machinery skips the term and says
    // so, which is the honest reading of an absent range.
    ci95Low: null,
    ci95High: null,
    // The set's note is deliberately not repeated here. It is a fact about the
    // set, shown once beside it; carrying it onto all three or four gas records
    // would print the same paragraph four times in the working panel.
  };
}

function describeSet(set: GwpSet): GwpSetAudit {
  return {
    id: set.id,
    label: set.label,
    horizonYears: set.horizon_years,
    fossilSplit: set.fossil_split,
    provenance: set.provenance,
    source: set.source,
    sourcePrecision: set.source_precision ?? null,
    verified: set.verified,
    note: set.note ?? null,
  };
}

/**
 * Caveats to show beside the total.
 *
 * The memo note is not a defect being reported — it is the rule being obeyed,
 * said out loud. A user looking at a firewood result needs to know that the
 * largest number in the calculation is deliberately not in the total.
 */
function setGaps(set: GwpSet, memoItems: GasCarbonDioxideEquivalent[]): ParameterGap[] {
  const gaps: ParameterGap[] = [];

  if (!set.verified) {
    gaps.push({
      kind: 'unverified_parameter',
      parameterId: set.id,
      message:
        `The ${set.label} global warming potentials have not been verified against their ` +
        `primary source` +
        (set.source_precision === 'report_level'
          ? `; the source names the report but not yet the table.`
          : `.`),
    });
  }

  for (const memo of memoItems) {
    gaps.push({
      kind: 'unverified_parameter',
      gas: memo.gas,
      parameterId: memo.gwp.valueId,
      // The reason itself is on the memo figure, where the reader is already
      // looking. Repeating it here would push the other caveats off the screen.
      message:
        `${formatNumber(memo.co2eKg)} kg CO2-eq of biomass ${memo.gas} is reported separately ` +
        `and is not included in the total.`,
    });
  }

  return gaps;
}

function totalWorkings(contributing: GasCarbonDioxideEquivalent[], totalKg: number): string {
  if (contributing.length === 0) {
    return 'No gas contributes to the total.';
  }

  const parts = contributing.map(
    (entry) =>
      `${formatNumber(entry.kg)} kg ${entry.gas} x ${formatNumber(entry.gwp.value)}` +
      ` = ${formatNumber(entry.co2eKg)}`,
  );

  return `${parts.join('\n+ ')}\n= ${formatNumber(totalKg)} kg CO2-eq`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
