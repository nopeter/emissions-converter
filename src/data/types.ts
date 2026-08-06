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

/**
 * Provenance class for a unit conversion. A separate, parallel vocabulary.
 *
 * A conversion is not an emission parameter and does not belong to the three
 * classes above. Nothing in `units` was measured: `exact` says the relationship
 * is a definition, which is a stronger claim than `ipcc`, not a weaker one.
 * `ipcc_approximate` is the one place the Guidelines offer a rule of thumb
 * instead of a factor, and `user_provided` covers a figure the user typed in.
 *
 * The two vocabularies must never be shown with the same chip; see
 * `conversion_provenance_note` in the library.
 */
export type ConversionProvenance = 'exact' | 'ipcc_approximate' | 'user_provided';

/** What kind of quantity a unit measures. */
export type UnitMeasure = 'mass' | 'volume' | 'energy' | 'density';

/**
 * A unit the user may enter a quantity in, and the defined factor that takes it
 * to the engine's canonical unit for its kind.
 *
 * Canonical units: kilograms for mass, cubic metres for volume, terajoules for
 * energy, kilograms per cubic metre for density. Every factor is exact, because
 * every one of them is a definition rather than a measurement — which is why
 * applying one adds no uncertainty term.
 */
export interface Unit {
  id: string;
  label: string;
  /** How the unit is written beside a number, e.g. "m³". */
  symbol: string;
  measures: UnitMeasure;
  canonical_unit: string;
  factor: number;
  provenance: ConversionProvenance;
  source: string;
  verified: boolean;
  note?: string;
}

/**
 * The Guidelines' rule of thumb for converting a gross calorific value to a net
 * one, for one family of fuels.
 *
 * `reduction_percent` is what Vol 2 Ch 1 actually states — "about 5 percent
 * below" — and the multiplier is derived from it in the engine rather than
 * stored, so there is one number here to be wrong rather than two that can
 * disagree. There is deliberately no record for solid biomass: the Guidelines
 * publish no rule of thumb for it, and the engine refuses rather than borrowing
 * the coal-and-oil one (CLAUDE.md rule 7).
 */
export interface CalorificBasisConversion {
  id: string;
  label: string;
  fuel_family: string;
  /** How far below the gross value the net value sits, in percent. */
  reduction_percent: number;
  provenance: ConversionProvenance;
  source: string;
  verified: boolean;
  note: string;
}

/**
 * A common purchase quantity offered as a one-tap shortcut, e.g. a gas cylinder.
 *
 * Always `assumed`: a 12.5 kg cylinder is named by what it holds when full, so
 * the preset assumes a full one. The UI must put the resulting figure in an
 * editable field rather than treating it as measured (CLAUDE.md rule 2).
 */
export interface FuelPreset {
  id: string;
  label: string;
  /** Id of the unit `quantity` is expressed in. */
  unit: string;
  quantity: number;
  provenance: Provenance;
  source: string | null;
  verified: boolean;
  note: string;
}

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
  /** Id of the unit to preselect: the one this fuel is actually sold in. */
  default_unit: string;
  /**
   * Which gross-to-net rule of thumb applies, when one does. Absent for solid
   * biomass, where the Guidelines publish none and the engine refuses to
   * convert rather than borrowing another family's.
   */
  calorific_basis_family?: string;
  /** Why this fuel is in that family, where the assignment is not obvious. */
  calorific_basis_family_note?: string;
  /** In the current minimum viable product scope. */
  mvp: boolean;
  /**
   * Id of an unsourced density record. It no longer blocks the fuel outright —
   * the user is asked for a density instead — but it does mean there is no
   * default to offer them, and no value the engine may fall back on.
   */
  blocked_by?: string;
  /** One-tap purchase quantities, e.g. gas cylinders. Always `assumed`. */
  presets?: FuelPreset[];
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
  /**
   * Id of a density unit in `units`. With `value` null this is the record's
   * most useful field: it names the unit this fuel's suppliers quote, which is
   * the one the density prompt should offer first.
   */
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
  conversion_provenance_classes: Record<ConversionProvenance, string>;
  /** Why unit conversions do not share the parameter provenance classes. */
  conversion_provenance_note: string;
  uncertainty_convention: UncertaintyConvention;
  units_note: string;
  units: Unit[];
  /** Why a gross calorific value has to be converted, and how approximately. */
  calorific_basis_note: string;
  calorific_basis_conversions: CalorificBasisConversion[];
  categories: Record<CategoryCode, string>;
  net_calorific_values: NetCalorificValue[];
  fuels: Fuel[];
  emission_factors: EmissionFactor[];
  /** What a null density now means: ask the user, never guess. */
  densities_note: string;
  densities: Density[];
  /**
   * Why every GWP set is `external`, with the citations. Library-level because
   * it is a fact about the 2006 Guidelines, not about any one set.
   */
  gwp_sets_note: string;
  gwp_sets: GwpSet[];
  open_questions: string[];
}
