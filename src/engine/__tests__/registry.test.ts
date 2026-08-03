/**
 * The IPCC category tree.
 *
 * Two things are being protected here. The first is that the tree stays a tree:
 * unique codes, every parent present, no chain that loops back on itself, and
 * every module claimed by exactly one category. The second, and the one that
 * matters more, is that the tree stays honest about the parameter library — a
 * node's full name is built from its ancestors, and it must come out identical
 * to the label the library publishes for that code. If someone renames a
 * category in one place and not the other, that is a failing test rather than
 * two different names for the same thing in front of a user.
 */
import { describe, expect, it } from 'vitest';
import { parameters } from '../../data';
import { createFuelCombustionModule, FUEL_COMBUSTION_MODULE_ID } from '../combustion';
import { EngineError } from '../errors';
import type { CalculationModule } from '../module';
import {
  CATEGORY_DEFINITIONS,
  categoryRegistry,
  createCategoryRegistry,
  PATH_SEPARATOR,
  SECTOR_VOLUMES,
  type CategoryDefinition,
} from '../registry';

/** A module that exists only to be registered; it is never calculated with. */
function stubModule(categoryCode: string): CalculationModule {
  return {
    id: `stub_${categoryCode}`,
    label: 'Stub',
    categoryCode,
    declareInputs: () => ({ categoryCode, inputs: [] }),
    availableTiers: () => [],
    calculate: () => {
      throw new Error('the stub module does not calculate');
    },
  };
}

describe('the definitions form a tree', () => {
  it('gives every category a unique code', () => {
    const codes = CATEGORY_DEFINITIONS.map((definition) => definition.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names a parent that exists, or none at all', () => {
    const codes = new Set(CATEGORY_DEFINITIONS.map((definition) => definition.code));
    for (const definition of CATEGORY_DEFINITIONS) {
      if (definition.parent !== null) {
        expect(codes.has(definition.parent)).toBe(true);
      }
    }
  });

  it('resolves every definition into exactly one node', () => {
    expect(categoryRegistry.all()).toHaveLength(CATEGORY_DEFINITIONS.length);
  });

  it('has one sector root, Energy, because that is the sector being built', () => {
    expect(categoryRegistry.roots().map((node) => node.code)).toEqual(['1']);
    expect(categoryRegistry.roots()[0].sector).toBe('Energy');
    expect(categoryRegistry.roots()[0].parent).toBeNull();
    expect(categoryRegistry.roots()[0].depth).toBe(0);
  });

  it('hangs each node under its parent', () => {
    expect(categoryRegistry.get('1').children.map((node) => node.code)).toEqual(['1A']);
    expect(categoryRegistry.get('1A').children.map((node) => node.code)).toEqual(['1A3', '1A4']);
    expect(categoryRegistry.get('1A3').children.map((node) => node.code)).toEqual(['1A3b']);
    expect(categoryRegistry.get('1A4').children.map((node) => node.code)).toEqual(['1A4b']);
    expect(categoryRegistry.get('1A4b').children).toEqual([]);
  });

  it('lists ancestors from the sector root down', () => {
    expect(categoryRegistry.ancestors('1A4b').map((node) => node.code)).toEqual(['1', '1A', '1A4']);
    expect(categoryRegistry.ancestors('1A3b').map((node) => node.code)).toEqual(['1', '1A', '1A3']);
    expect(categoryRegistry.ancestors('1')).toEqual([]);
  });

  it('records how deep each node sits, so the interface can indent it', () => {
    expect(categoryRegistry.get('1A').depth).toBe(1);
    expect(categoryRegistry.get('1A4').depth).toBe(2);
    expect(categoryRegistry.get('1A4b').depth).toBe(3);
  });

  it('files every category under a sector, with that sector’s volume', () => {
    for (const node of categoryRegistry.all()) {
      expect(Object.keys(SECTOR_VOLUMES)).toContain(node.sector);
      expect(node.volume).toBe(SECTOR_VOLUMES[node.sector]);
    }
  });

  it('knows the volume of all four sectors, not only the one being built', () => {
    expect(Object.keys(SECTOR_VOLUMES).sort()).toEqual(['AFOLU', 'Energy', 'IPPU', 'Waste']);
  });
});

describe('the tree agrees with the parameter library', () => {
  it('derives a full name identical to the library’s own label', () => {
    // The load-bearing assertion of this file. The library publishes
    // "Energy > Fuel combustion > Other sectors > Residential" for 1A4b; the
    // registry builds that string from four separate node names. They must not
    // be allowed to disagree.
    for (const [code, label] of Object.entries(parameters.categories)) {
      const node = categoryRegistry.find(code);
      expect(node, `category ${code} is in the library but not in the registry`).toBeDefined();
      expect(node?.path).toBe(label);
    }
  });

  it('joins name segments the way the library writes them', () => {
    expect(categoryRegistry.get('1A4b').path).toBe(
      ['Energy', 'Fuel combustion', 'Other sectors', 'Residential'].join(PATH_SEPARATOR),
    );
  });

  it('has a node for the category of every emission factor', () => {
    for (const factor of parameters.emission_factors) {
      expect(categoryRegistry.find(factor.category), `${factor.id}`).toBeDefined();
    }
  });

  it('has a node for the category of every other parameter that names one', () => {
    const records = [
      ...parameters.net_calorific_values,
      ...parameters.fuels,
      ...parameters.densities,
      ...parameters.gwp_sets,
    ];
    for (const record of records) {
      if (record.category === null) {
        continue;
      }
      expect(categoryRegistry.find(record.category), `${record.id}`).toBeDefined();
    }
  });
});

describe('modules are registered against categories', () => {
  it('gives the two categories with published factors a module', () => {
    expect(categoryRegistry.calculable().map((node) => node.code)).toEqual(['1A3b', '1A4b']);
  });

  it('registers fuel combustion against both of them', () => {
    for (const code of ['1A4b', '1A3b']) {
      const module = categoryRegistry.requireModule(code);
      expect(module.id).toBe(FUEL_COMBUSTION_MODULE_ID);
      expect(module.categoryCode).toBe(code);
    }
  });

  it('leaves the grouping categories without a module', () => {
    for (const code of ['1', '1A', '1A3', '1A4']) {
      expect(categoryRegistry.moduleFor(code)).toBeNull();
    }
  });

  it('says a category is unimplemented rather than returning zero for it', () => {
    // A category that exists in the Guidelines but has no module is a gap in
    // the calculator. Returning nothing for it would read as "no emissions".
    try {
      categoryRegistry.requireModule('1A');
      expect.unreachable('expected a no-module error');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('no_module_for_category');
      expect((error as EngineError).message).toContain('not a value of zero');
    }
  });

  it('throws on a code that is not in the tree, listing the ones that are', () => {
    try {
      categoryRegistry.get('4A1');
      expect.unreachable('expected an unknown-category error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_category');
      expect((error as EngineError).message).toContain('4A1');
      expect((error as EngineError).message).toContain('1A4b');
    }
  });

  it('returns undefined from find, rather than throwing, for an unknown code', () => {
    expect(categoryRegistry.find('4A1')).toBeUndefined();
  });
});

describe('a malformed registry fails at construction', () => {
  const energy: CategoryDefinition = {
    code: '1',
    name: 'Energy',
    sector: 'Energy',
    parent: null,
  };

  it('rejects a repeated code', () => {
    expect(() => createCategoryRegistry([energy, energy], [])).toThrowError(
      /defined more than once/,
    );
    try {
      createCategoryRegistry([energy, energy], []);
    } catch (error) {
      expect((error as EngineError).code).toBe('duplicate_category');
    }
  });

  it('rejects a parent that does not exist', () => {
    const orphan: CategoryDefinition = {
      code: '1A',
      name: 'Fuel combustion',
      sector: 'Energy',
      parent: '9',
    };
    try {
      createCategoryRegistry([energy, orphan], []);
      expect.unreachable('expected an unknown-parent error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_parent_category');
      expect((error as EngineError).message).toContain('1A');
    }
  });

  it('rejects a parent chain that loops back on itself', () => {
    const first: CategoryDefinition = { code: 'A', name: 'A', sector: 'Energy', parent: 'B' };
    const second: CategoryDefinition = { code: 'B', name: 'B', sector: 'Energy', parent: 'A' };
    try {
      createCategoryRegistry([first, second], []);
      expect.unreachable('expected a cycle error');
    } catch (error) {
      expect((error as EngineError).code).toBe('category_cycle');
      expect((error as EngineError).message).toContain('do not form a tree');
    }
  });

  it('rejects a module registered against a category nobody declared', () => {
    try {
      createCategoryRegistry([energy], [stubModule('4A1')]);
      expect.unreachable('expected an unknown-category error');
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_category');
      expect((error as EngineError).message).toContain('4A1');
    }
  });

  it('rejects two modules claiming the same category', () => {
    try {
      createCategoryRegistry([energy], [stubModule('1'), stubModule('1')]);
      expect.unreachable('expected a duplicate-module error');
    } catch (error) {
      expect((error as EngineError).code).toBe('duplicate_module');
      expect((error as EngineError).message).toContain('methodological choice');
    }
  });

  it('builds an independent registry, leaving the shipped one untouched', () => {
    const other = createCategoryRegistry([energy], [createFuelCombustionModule('1')]);
    expect(other.requireModule('1').categoryCode).toBe('1');
    expect(categoryRegistry.moduleFor('1')).toBeNull();
  });
});
