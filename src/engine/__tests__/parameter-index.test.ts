/**
 * The parameter library, indexed by category code.
 *
 * Every record now declares which IPCC category it belongs to, so the library
 * can be read the same way the engine is organised. These tests hold the field
 * to being a fact rather than a label: a code that appears on a record must be a
 * code the category tree knows, and the index must contain every record exactly
 * once — nothing filed twice, nothing quietly dropped.
 *
 * This change added a field. It changed no value, no source and no provenance
 * class, and the assertions below say so explicitly.
 */
import { describe, expect, it } from 'vitest';
import { indexParametersByCategory, parameters, parametersByCategory } from '../../data';
import { categoryRegistry } from '../registry';

describe('every record declares a category', () => {
  it('files calorific values, fuels and densities under fuel combustion', () => {
    // Vol 2 Ch 1 Table 1.2 applies wherever a fuel is burned, not to one
    // subcategory of it, so these sit at 1A rather than being repeated below it.
    for (const record of [
      ...parameters.net_calorific_values,
      ...parameters.fuels,
      ...parameters.densities,
    ]) {
      expect(record.category, record.id).toBe('1A');
    }
  });

  it('files emission factors under the subcategory they were published for', () => {
    for (const factor of parameters.emission_factors) {
      expect(['1A4b', '1A3b'], factor.id).toContain(factor.category);
    }
  });

  it('files global warming potentials under no category at all', () => {
    // GWPs are applied to every gas from every source. Filing them under one
    // code would be false precision, and they are external to the Guidelines
    // besides (CLAUDE.md rule 4).
    for (const set of parameters.gwp_sets) {
      expect(set.category, set.id).toBeNull();
      expect(set.provenance).toBe('external');
    }
  });

  it('never names a category the tree does not have', () => {
    const records = [
      ...parameters.net_calorific_values,
      ...parameters.fuels,
      ...parameters.densities,
      ...parameters.emission_factors,
      ...parameters.gwp_sets,
    ];
    for (const record of records) {
      if (record.category === null) {
        continue;
      }
      expect(categoryRegistry.find(record.category), record.id).toBeDefined();
    }
  });
});

describe('the index is complete and lossless', () => {
  it('indexes every record exactly once', () => {
    const indexed = [...parametersByCategory.values()];
    const count = (pick: (entry: (typeof indexed)[number]) => unknown[]): number =>
      indexed.reduce((total, entry) => total + pick(entry).length, 0);

    expect(count((entry) => entry.emission_factors)).toBe(parameters.emission_factors.length);
    expect(count((entry) => entry.net_calorific_values)).toBe(
      parameters.net_calorific_values.length,
    );
    expect(count((entry) => entry.fuels)).toBe(parameters.fuels.length);
    expect(count((entry) => entry.densities)).toBe(parameters.densities.length);
  });

  it('has a bucket for each category that owns records', () => {
    expect([...parametersByCategory.keys()].sort()).toEqual(['1A', '1A3b', '1A4b']);
  });

  it('puts the residential factors under 1A4b', () => {
    const residential = parametersByCategory.get('1A4b');
    expect(residential?.emission_factors.map((factor) => factor.id)).toContain('ef_1a4b_lpg_co2');
    expect(residential?.emission_factors.every((factor) => factor.category === '1A4b')).toBe(true);
  });

  it('indexes by exact code, leaving the tree to decide what a category inherits', () => {
    // Calorific values are filed at 1A. A lookup of 1A4b returns what is filed
    // at 1A4b and nothing more; whether 1A4b may use 1A's parameters is a
    // statement about the tree, not about the index.
    expect(parametersByCategory.get('1A4b')?.net_calorific_values).toEqual([]);
    expect(parametersByCategory.get('1A')?.net_calorific_values).toHaveLength(
      parameters.net_calorific_values.length,
    );
  });

  it('indexes an alternative library without touching the shipped one', () => {
    const smaller = indexParametersByCategory({
      ...parameters,
      emission_factors: parameters.emission_factors.filter(
        (factor) => factor.category === '1A4b',
      ),
    });
    expect(smaller.get('1A3b')).toBeUndefined();
    expect(parametersByCategory.get('1A3b')?.emission_factors.length).toBeGreaterThan(0);
  });
});

describe('adding the field changed nothing else', () => {
  it('leaves every provenance class and source in place', () => {
    for (const factor of parameters.emission_factors) {
      expect(['ipcc', 'external', 'assumed']).toContain(factor.provenance);
      expect(factor.source).toBeTruthy();
    }
    for (const ncv of parameters.net_calorific_values) {
      expect(ncv.provenance).toBe('ipcc');
      expect(ncv.source).toContain('Table 1.2');
    }
  });

  it('still leaves the unsourced densities unsourced', () => {
    for (const density of parameters.densities) {
      if (density.status === 'unsourced') {
        expect(density.value).toBeNull();
        expect(density.source).toBeNull();
      }
    }
  });
});
