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
  /**
   * The IPCC category this parameter belongs to, so the library can be indexed
   * by the same tree the engine's modules are registered against.
   *
   * A parameter used across a whole branch is filed at that branch: the net
   * calorific values of Vol 2 Ch 1 Table 1.2 are used everywhere fuel is burned,
   * so they sit at "1A" rather than being repeated on every subcategory.
   *
   * `null` means the record genuinely belongs to no category. Global warming
   * potentials are the case in point: they are applied to every gas from every
   * source, so filing them under one code would be false precision.
   */
  category: CategoryCode | null;
  provenance: Provenance;
  /** Naming the IPCC volume/chapter/table, or the external source. `null` when unsourced. */
  source: string | null;
  /** False means the figure has not been checked against its primary source. */
  verified: boolean;
  note?: string;
}

/** Net calorific value, used to convert a fuel mass into energy. */
export interface NetCalorificValue extends ProvenancedRecord, ConfidenceInterval95 {
  /** "1A": a calorific value applies wherever the fuel is burned. */
  category: CategoryCode;
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
  /** "1A": the fuel list exists to serve fuel combustion. */
  category: CategoryCode;
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
  /** "1A": a density converts a purchased volume of a combustion fuel to mass. */
  category: CategoryCode;
  fuel: string;
  value: number | null;
  unit: string;
  status?: 'unsourced' | 'sourced';
  /** Plain-English explanation of what the missing value blocks. */
  blocking?: string;
}

/**
 * A named set of global warming potentials.
 *
 * Present in the library but not used by the engine yet: no CO2-equivalent
 * calculation exists in this change. GWPs are always `external`, because the
 * 2006 Guidelines reference GWP values but do not publish a table.
 */
export interface GwpSet extends ProvenancedRecord {
  label: string;
  horizon_years: number;
  values: Record<Gas, number>;
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
  gwp_sets: GwpSet[];
  open_questions: string[];
}
