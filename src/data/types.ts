/**
 * TypeScript model of `src/data/parameters.json`.
 *
 * These types exist so that the engine can never silently read a field that the
 * parameter library does not actually publish. In particular:
 *
 *  - `Provenance` is a closed union. A value is either read from the 2006 IPCC
 *    Guidelines, sourced elsewhere, or assumed by us. There is no fourth class,
 *    and no default: every record must declare one.
 *  - Confidence-interval bounds are `number | null`. `null` means the IPCC did
 *    not publish a range (see the LPG transport CH4/N2O records). It does not
 *    mean zero uncertainty, and it must never be coerced to a number.
 *  - `memo_item` marks biomass CO2, which is reported separately and excluded
 *    from the headline total (Vol 2 Ch 2).
 */

/** Provenance class. Must be surfaced in the UI; see CLAUDE.md rule 2. */
export type Provenance = 'ipcc' | 'external' | 'assumed';

/** The three gases the engine computes. CO2-equivalent is a derived view, added later. */
export type Gas = 'CO2' | 'CH4' | 'N2O';

/** IPCC methodological tier. Data specificity, not effort; see CLAUDE.md rule 6. */
export type Tier = 1 | 2 | 3;

/** IPCC source category code, e.g. "1A4b" (residential) or "1A3b" (road transport). */
export type CategoryCode = string;

/**
 * A published 95% confidence interval.
 *
 * Both bounds are nullable and are always nullable together in practice: the
 * IPCC either publishes a range or it does not. Consumers must handle `null` by
 * skipping the term and recording the omission, never by substituting a value.
 */
export interface ConfidenceInterval95 {
  ci95_low: number | null;
  ci95_high: number | null;
}

/** Fields every parameter record carries, whatever kind of parameter it is. */
export interface ProvenancedRecord {
  id: string;
  provenance: Provenance;
  /** Naming the IPCC volume/chapter/table, or the external source. `null` when unsourced. */
  source: string | null;
  /** False means the figure has not been checked against its primary source. */
  verified: boolean;
  note?: string;
}

/** Net calorific value, used to convert a fuel mass into energy. */
export interface NetCalorificValue extends ProvenancedRecord, ConfidenceInterval95 {
  fuel: string;
  label: string;
  value: number;
  /** Always "TJ/Gg" in the current library; the engine asserts this before converting. */
  unit: string;
  /**
   * True when the published interval is not symmetric about `value`. The engine
   * treats such intervals as symmetric for Approach 1 propagation and flags the
   * simplification in the audit trail.
   */
  asymmetric?: boolean;
}

/** A fuel the calculator knows about. */
export interface Fuel {
  id: string;
  label: string;
  /**
   * True for biofuels. Their CO2 is a memo item; their CH4 and N2O are not.
   * The authoritative memo flag lives on the emission factor record, not here.
   */
  biomass: boolean;
  sold_by: 'mass' | 'volume' | 'volume_or_energy';
  common_units: string[];
  /** In the current minimum viable product scope. */
  mvp: boolean;
  /** Id of a missing parameter (typically a density) that blocks this fuel. */
  blocked_by?: string;
  note?: string;
}

/** An emission factor, in kg of gas per TJ of fuel energy. */
export interface EmissionFactor extends ProvenancedRecord, ConfidenceInterval95 {
  category: CategoryCode;
  fuel: string;
  gas: Gas;
  tier: Tier;
  value: number;
  /** Always "kg/TJ" in the current library; the engine asserts this before applying it. */
  unit: string;
  /** Tier 3 disaggregation, e.g. "uncontrolled", "oxidation_catalyst". */
  vehicle_technology?: string;
  vehicle_technology_label?: string;
  /**
   * True when this gas is reported as an information item and excluded from the
   * headline total. Absent is equivalent to false.
   */
  memo_item?: boolean;
  /** Why the memo treatment applies. Shown to the user beside the memo figure. */
  memo_reason?: string;
}

/**
 * Fuel density, for converting a purchased volume into a mass.
 *
 * Every density in the library currently has `value: null` and
 * `status: "unsourced"`. That is a deliberate, visible gap: volume-based inputs
 * stay blocked until a citable source exists. Never fill these in from general
 * knowledge (CLAUDE.md rule 7).
 */
export interface Density extends ProvenancedRecord {
  fuel: string;
  value: number | null;
  unit: string;
  status?: 'unsourced' | 'sourced';
  /** Plain-English explanation of what the missing value blocks. */
  blocking?: string;
}

/**
 * Which emissions a single GWP value applies to.
 *
 * `all` is the normal case: one value covers every source of that gas. AR6 is
 * the exception — it publishes a higher 100-year GWP for fossil methane than
 * for non-fossil methane, so its CH4 is carried as two records, `fossil` and
 * `non_fossil`. That distinction is not cosmetic here: charcoal and firewood
 * are non-fossil, so it changes their CO2-equivalent figure.
 */
export type GwpOrigin = 'all' | 'fossil' | 'non_fossil';

/**
 * One global warming potential, for one gas, from one assessment report.
 *
 * Named rather than anonymous — every value has its own id and label — so that
 * a set can carry more than one value for a gas without the extra value being
 * an unlabelled special case.
 */
export interface GwpValue {
  id: string;
  gas: Gas;
  origin: GwpOrigin;
  label: string;
  /** Dimensionless: kg CO2-eq per kg of gas, over the set's horizon. */
  value: number;
}

/**
 * A named set of global warming potentials.
 *
 * Present in the library but not used by the engine yet: no CO2-equivalent
 * calculation exists in this change. GWPs are always `external`, because the
 * 2006 Guidelines do not publish a GWP table (see `gwp_sets_note`); a set
 * claiming `ipcc` provenance is a bug, and the data-integrity tests fail on it.
 */
export interface GwpSet extends ProvenancedRecord {
  label: string;
  horizon_years: number;
  /**
   * True when the set splits methane by fossil versus non-fossil origin, in
   * which case `values` holds exactly one `fossil` and one `non_fossil` CH4
   * record. False when a single `all` CH4 record covers both.
   */
  fossil_split: boolean;
  values: GwpValue[];
  /**
   * How precisely `source` locates the figures. `report_level` means the source
   * names the assessment report but the exact table has not been confirmed, so
   * the set cannot be marked verified.
   */
  source_precision?: 'report_level' | 'table_level';
  status?: string;
}

export interface UncertaintyConvention {
  interval: string;
  note: string;
  method_multiplication: string;
  method_addition: string;
}

/** The whole parameter library, as loaded from parameters.json. */
export interface ParameterLibrary {
  schema_version: string;
  library_version: string;
  updated: string;
  methodology: string;
  readme: string;
  provenance_classes: Record<Provenance, string>;
  uncertainty_convention: UncertaintyConvention;
  categories: Record<CategoryCode, string>;
  net_calorific_values: NetCalorificValue[];
  fuels: Fuel[];
  emission_factors: EmissionFactor[];
  densities: Density[];
  /**
   * Why every GWP set is `external`, with the citations. Library-level because
   * it is a fact about the 2006 Guidelines, not about any one set.
   */
  gwp_sets_note: string;
  gwp_sets: GwpSet[];
  open_questions: string[];
}
