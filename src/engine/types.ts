/**
 * Result and audit-trail types for the calculation engine.
 *
 * Every engine function returns both a result and an audit trail: what was put
 * in, which factor was used, where that factor came from, and which equation was
 * applied. The audit trail is not debug output — it is the product. A number
 * without its provenance is not shippable (CLAUDE.md rule 1).
 */
import type { CategoryCode, Gas, GwpOrigin, Provenance, Tier } from '../data/types';

/** What part a parameter plays in the calculation. */
export type ParameterRole =
  | 'activity_data'
  | 'net_calorific_value'
  | 'emission_factor'
  | 'global_warming_potential';

/** Why an uncertainty term was left out of the Approach 1 combination. */
export type UncertaintySkipReason =
  /** The IPCC publishes the factor but not a 95% confidence interval for it. */
  | 'confidence_interval_not_published'
  /** The caller supplied no uncertainty for this term (e.g. user-entered mass). */
  | 'not_provided'
  /** The central value is zero, so a percentage uncertainty is undefined. */
  | 'zero_central_value';

/** An uncertainty term that was included in Eq 3.1. */
export interface UncertaintyTerm {
  parameterId: string;
  role: ParameterRole;
  label: string;
  value: number;
  ci95Low: number;
  ci95High: number;
  /** Half-width of the interval as a percentage of the central value. */
  percent: number;
  /** True when the published interval is not symmetric about the central value. */
  asymmetric: boolean;
  /** Set only when `asymmetric` is true: how the interval was simplified. */
  symmetrisation?: string;
}

/** An uncertainty term that was deliberately left out, and why. */
export interface SkippedUncertaintyTerm {
  parameterId: string;
  role: ParameterRole;
  label: string;
  reason: UncertaintySkipReason;
  /** Plain-English explanation, suitable for display next to the result. */
  note: string;
}

/** The outcome of combining uncertainties with Vol 1 Ch 3 Eq 3.1. */
export interface UncertaintyResult {
  /** The equation applied, quoted from the parameter library's own convention. */
  equation: string;
  /** Combined percentage uncertainty, or null when no term could be included. */
  percent: number | null;
  terms: UncertaintyTerm[];
  skipped: SkippedUncertaintyTerm[];
  /**
   * True when at least one term was skipped. The reported percentage then
   * understates the real uncertainty and must be labelled as a lower bound.
   */
  incomplete: boolean;
  /** Ids of parameters whose asymmetric interval was treated as symmetric. */
  symmetrisedParameters: string[];
}

/** A parameter as it was used, carrying everything needed to cite it. */
export interface FactorAudit {
  parameterId: string;
  role: ParameterRole;
  label: string;
  value: number;
  unit: string;
  provenance: Provenance;
  source: string | null;
  verified: boolean;
  ci95Low: number | null;
  ci95High: number | null;
  tier?: Tier;
  note?: string;
}

/** How one gas figure was produced. */
export interface GasAudit {
  gas: Gas;
  /** Vol 2 Ch 2 Eq 2.1, written out. */
  equation: string;
  /** The equation with this calculation's numbers substituted in. */
  workings: string;
  fuelConsumptionTJ: number;
  emissionFactorKgPerTJ: number;
  factors: FactorAudit[];
}

/** One gas, with its emission, its uncertainty and its audit trail. */
export interface GasEmission {
  gas: Gas;
  kg: number;
  /** True when this figure is reported separately and excluded from the total. */
  memoItem: boolean;
  memoReason: string | null;
  tier: Tier;
  uncertainty: UncertaintyResult;
  audit: GasAudit;
}

/**
 * Why a returned figure carries a caveat.
 *
 * A missing, null or ambiguous factor is no longer a gap: it throws an
 * `EngineError`, because a result computed around a hole would read as a
 * complete answer. What remains here is the case where a figure was produced
 * but something about the parameters behind it should be shown alongside it.
 */
export type GapKind = 'unverified_parameter';

/**
 * A clearly-labelled caveat on a result the engine did produce.
 *
 * Caveats are returned, never suppressed. The UI shows them next to the number
 * they qualify (CLAUDE.md rule 7).
 */
export interface ParameterGap {
  kind: GapKind;
  gas?: Gas;
  parameterId?: string;
  message: string;
}

/** How the input mass became an energy quantity. */
export interface EnergyConversionAudit {
  equation: string;
  workings: string;
  massKg: number;
  massGg: number;
  ncvValue: number;
  ncvUnit: string;
  energyTJ: number;
}

/** Everything needed to reconstruct the calculation from the inputs. */
export interface CombustionAudit {
  library: {
    schemaVersion: string;
    libraryVersion: string;
    updated: string;
    methodology: string;
  };
  inputs: {
    fuelId: string;
    massKg: number;
    categoryCode: CategoryCode;
    vehicleTechnology: string | null;
    activityDataUncertaintyPercent: number | null;
  };
  energyConversion: EnergyConversionAudit;
  /** Every parameter touched by this calculation, in the order it was applied. */
  factors: FactorAudit[];
}

/** The full result of a fuel-combustion calculation. */
export interface CombustionResult {
  fuelId: string;
  fuelLabel: string;
  biomass: boolean;
  categoryCode: CategoryCode;
  categoryLabel: string;
  massKg: number;
  energyTJ: number;
  /** Gases that count towards the headline total. */
  totalContributing: GasEmission[];
  /** Gases reported separately and excluded from the headline total. */
  memoItems: GasEmission[];
  /**
   * Caveats on the figures above. Never a substitute for a missing factor: if a
   * factor were missing, this result would not exist.
   */
  gaps: ParameterGap[];
  audit: CombustionAudit;
}

/**
 * Which GWP was applied to one gas, and why that one rather than another.
 *
 * `originReason` matters for AR6, which publishes a higher 100-year methane GWP
 * for fossil methane than for non-fossil methane. The engine picks by the fuel's
 * biomass flag, and records the choice here so the user is told which of the two
 * they are looking at rather than having to infer it.
 */
export interface GwpSelection {
  setId: string;
  setLabel: string;
  horizonYears: number;
  valueId: string;
  valueLabel: string;
  gas: Gas;
  origin: GwpOrigin;
  /** Dimensionless: kg CO2-eq per kg of gas. */
  value: number;
  originReason: string;
}

/** One gas restated in CO2-equivalent. */
export interface GasCarbonDioxideEquivalent {
  gas: Gas;
  /** The gas figure this was derived from, in kg of the gas itself. */
  kg: number;
  gwp: GwpSelection;
  co2eKg: number;
  /** True when this figure is reported separately and excluded from the total. */
  memoItem: boolean;
  memoReason: string | null;
  /**
   * The gas's own combined uncertainty, carried through unchanged. Multiplying
   * by a GWP would add a term under Eq 3.1, but no GWP in the library publishes
   * a confidence interval, so there is no term to add — the omission is recorded
   * in the result's `uncertainty.skipped` rather than treated as exact.
   */
  uncertaintyPercent: number | null;
  audit: {
    equation: string;
    workings: string;
    gwp: FactorAudit;
  };
}

/** The GWP set a CO2-equivalent view was computed with, as it was used. */
export interface GwpSetAudit {
  id: string;
  label: string;
  horizonYears: number;
  fossilSplit: boolean;
  provenance: Provenance;
  source: string | null;
  /** How precisely `source` locates the figures, when the library says. */
  sourcePrecision: string | null;
  verified: boolean;
  note: string | null;
}

/** How a CO2-equivalent total was arrived at. */
export interface CarbonDioxideEquivalentAudit {
  /** What CO2-equivalent means, written out. Not an IPCC equation: see `libraryNote`. */
  definition: string;
  /** Vol 1 Ch 3 Eq 3.2, quoted from the parameter library. */
  additionEquation: string;
  /** The sum with this calculation's numbers substituted in. */
  workings: string;
  /** The library's record of why no GWP set can be IPCC-derived. */
  libraryNote: string;
}

/**
 * CO2, CH4 and N2O restated in CO2-equivalent and summed.
 *
 * A derived view over a `CombustionResult`, never a replacement for it: the
 * separate gas figures remain the primary result (CLAUDE.md rule 4). Biomass CO2
 * is in `memoItems` and is absent from `totalKg` (rule 3) — a CO2-equivalent
 * total does not change what belongs in a total.
 */
export interface CarbonDioxideEquivalentResult {
  gwpSet: GwpSetAudit;
  /** Gases that count towards `totalKg`. */
  contributing: GasCarbonDioxideEquivalent[];
  /** Gases reported separately and excluded from `totalKg`. */
  memoItems: GasCarbonDioxideEquivalent[];
  /** The headline figure, in kg CO2-eq. Excludes everything in `memoItems`. */
  totalKg: number;
  /** The memo items summed, in kg CO2-eq. Reported beside the total, never in it. */
  memoTotalKg: number;
  /** Combined by Eq 3.2, because the total is a sum. */
  uncertainty: UncertaintyResult;
  gaps: ParameterGap[];
  audit: CarbonDioxideEquivalentAudit;
}

/** Options that select between parameters, rather than supplying them. */
export interface CombustionOptions {
  /**
   * Selects among Tier 3 technology-disaggregated factors (Vol 2 Ch 3 Table
   * 3.2.2). When several factors match a gas and this is unset, the engine
   * throws rather than choosing one.
   */
  vehicleTechnology?: string;
  /**
   * Percentage uncertainty of the activity data, i.e. of the entered mass.
   * When unset, the activity-data term is recorded as skipped rather than
   * assumed to be zero.
   */
  activityDataUncertaintyPercent?: number;
}
