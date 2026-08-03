/**
 * The single typed entry point to the parameter library.
 *
 * Engine code imports `parameters` from here rather than importing the JSON
 * directly, so that there is exactly one place where the raw file is asserted
 * to match the declared types.
 */
import raw from './parameters.json';
import type {
  CategoryCode,
  Density,
  EmissionFactor,
  Fuel,
  NetCalorificValue,
  ParameterLibrary,
} from './types';

export const parameters = raw as unknown as ParameterLibrary;

/** The parameters filed under one IPCC category code. */
export interface CategoryParameters {
  code: CategoryCode;
  net_calorific_values: NetCalorificValue[];
  fuels: Fuel[];
  emission_factors: EmissionFactor[];
  densities: Density[];
}

/**
 * The library indexed by category code.
 *
 * Exact codes only: a lookup for "1A4b" returns what is filed at "1A4b", not
 * what is filed at "1A" above it. Deciding that a calculation of 1A4b may also
 * use the calorific values filed at 1A is a statement about the category tree,
 * so it belongs to the registry that models the tree — not to the index.
 *
 * Global warming potentials are absent by construction: their `category` is
 * null, because they apply to every gas from every source.
 */
export function indexParametersByCategory(
  library: ParameterLibrary = parameters,
): Map<CategoryCode, CategoryParameters> {
  const index = new Map<CategoryCode, CategoryParameters>();

  const bucket = (code: CategoryCode): CategoryParameters => {
    const existing = index.get(code);
    if (existing) {
      return existing;
    }
    const created: CategoryParameters = {
      code,
      net_calorific_values: [],
      fuels: [],
      emission_factors: [],
      densities: [],
    };
    index.set(code, created);
    return created;
  };

  for (const record of library.net_calorific_values) {
    bucket(record.category).net_calorific_values.push(record);
  }
  for (const record of library.fuels) {
    bucket(record.category).fuels.push(record);
  }
  for (const record of library.emission_factors) {
    bucket(record.category).emission_factors.push(record);
  }
  for (const record of library.densities) {
    bucket(record.category).densities.push(record);
  }

  return index;
}

/** The shipped library, indexed. */
export const parametersByCategory = indexParametersByCategory(parameters);

export * from './types';
