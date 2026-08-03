/**
 * The IPCC source category tree.
 *
 * The 2006 Guidelines are organised as a numbered hierarchy — sector, category,
 * subcategory — and every emission this calculator will ever report belongs to
 * exactly one node of it. Modelling that hierarchy explicitly is what lets the
 * interface render "Energy > Fuel combustion > Other sectors > Residential"
 * without a screen-by-screen list, and lets a new category arrive as a
 * definition plus a module rather than as a change to the interface.
 *
 * Two rules keep this file honest:
 *
 *  - A node's `path` is built from its ancestors' names, and a test asserts that
 *    the path of every category the parameter library knows about is identical to
 *    the label the library publishes for it. The tree cannot drift away from the
 *    data.
 *  - A node is `calculable` only when a module claims it. Categories that exist
 *    in the Guidelines but that nothing can calculate yet are visible as such,
 *    which is the honest state to be in while the Guidelines are implemented
 *    sector by sector.
 *
 * This file contains no emission parameters and no arithmetic. It is structure.
 */
import type { CategoryCode } from '../data/types';
import { createFuelCombustionModule } from './combustion';
import { EngineError } from './errors';
import type { CalculationModule } from './module';

/** The four inventory sectors of the 2006 Guidelines. */
export type Sector = 'Energy' | 'IPPU' | 'AFOLU' | 'Waste';

/**
 * Which volume of the Guidelines documents each sector.
 *
 * Derived rather than repeated on every category, so a category cannot be filed
 * under a volume that does not match its sector.
 */
export const SECTOR_VOLUMES: Record<Sector, string> = {
  Energy: 'Volume 2: Energy',
  IPPU: 'Volume 3: Industrial Processes and Product Use',
  AFOLU: 'Volume 4: Agriculture, Forestry and Other Land Use',
  Waste: 'Volume 5: Waste',
};

/** One category, as declared. The tree is derived from a list of these. */
export interface CategoryDefinition {
  /** IPCC code, e.g. "1A4b". */
  code: CategoryCode;
  /** The category's own name, e.g. "Residential". Not the full path. */
  name: string;
  sector: Sector;
  /** Code of the category this one sits under; null for a sector root. */
  parent: CategoryCode | null;
}

/** One category, as resolved into the tree. */
export interface CategoryNode {
  code: CategoryCode;
  name: string;
  sector: Sector;
  /** The volume of the Guidelines that documents this sector. */
  volume: string;
  parent: CategoryCode | null;
  /** Full name from the sector root down, e.g. "Energy > Fuel combustion > ...". */
  path: string;
  /** Depth below the sector root; a sector root is at depth zero. */
  depth: number;
  children: CategoryNode[];
  /** The module that calculates this category, or null if nothing does yet. */
  module: CalculationModule | null;
}

/** How the segments of a full category name are joined. */
export const PATH_SEPARATOR = ' > ';

/**
 * The categories this build knows about.
 *
 * Only the Energy spine leading to the two categories the parameter library
 * publishes factors for. The intermediate nodes (1, 1A, 1A3, 1A4) carry no
 * parameters and no module: they exist so the leaves have somewhere to hang and
 * so the interface can group them. Adding a category here does not add an
 * emission source — it adds a heading — until a module and its parameters
 * arrive with it.
 *
 * Names are the parameter library's own wording, segment for segment, so the
 * derived path matches the label the library publishes.
 */
export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  { code: '1', name: 'Energy', sector: 'Energy', parent: null },
  { code: '1A', name: 'Fuel combustion', sector: 'Energy', parent: '1' },
  { code: '1A3', name: 'Transport', sector: 'Energy', parent: '1A' },
  { code: '1A3b', name: 'Road transportation', sector: 'Energy', parent: '1A3' },
  { code: '1A4', name: 'Other sectors', sector: 'Energy', parent: '1A' },
  { code: '1A4b', name: 'Residential', sector: 'Energy', parent: '1A4' },
];

/** Reading the category tree. */
export interface CategoryRegistry {
  /** Sector roots, each with its children. */
  roots(): readonly CategoryNode[];
  /** Every node, parents before children. */
  all(): readonly CategoryNode[];
  find(code: CategoryCode): CategoryNode | undefined;
  /** Like `find`, but throws `unknown_category` rather than returning undefined. */
  get(code: CategoryCode): CategoryNode;
  /** From the sector root down to, but not including, this category. */
  ancestors(code: CategoryCode): CategoryNode[];
  /** Nodes with a module, in tree order. */
  calculable(): CategoryNode[];
  /** The module for a category, or null when nothing calculates it yet. */
  moduleFor(code: CategoryCode): CalculationModule | null;
  /** Like `moduleFor`, but throws rather than returning null. */
  requireModule(code: CategoryCode): CalculationModule;
}

/**
 * Build a registry from definitions and modules.
 *
 * Every structural mistake is a throw at construction, not a surprise later:
 * a repeated code, a parent that does not exist, a module claiming a category
 * nobody declared, or two modules claiming the same one.
 */
export function createCategoryRegistry(
  definitions: readonly CategoryDefinition[],
  modules: readonly CalculationModule[],
): CategoryRegistry {
  const nodes = new Map<CategoryCode, CategoryNode>();

  for (const definition of definitions) {
    if (nodes.has(definition.code)) {
      throw new EngineError(
        'duplicate_category',
        `Category "${definition.code}" is defined more than once. An IPCC code identifies exactly ` +
          `one source category.`,
      );
    }
    nodes.set(definition.code, {
      code: definition.code,
      name: definition.name,
      sector: definition.sector,
      volume: SECTOR_VOLUMES[definition.sector],
      parent: definition.parent,
      path: definition.name,
      depth: 0,
      children: [],
      module: null,
    });
  }

  for (const module of modules) {
    const node = nodes.get(module.categoryCode);
    if (!node) {
      throw new EngineError(
        'unknown_category',
        `Module "${module.id}" is registered against category "${module.categoryCode}", which is ` +
          `not defined in the category tree.`,
      );
    }
    if (node.module) {
      throw new EngineError(
        'duplicate_module',
        `Category "${node.code}" is claimed by both "${node.module.id}" and "${module.id}". Which ` +
          `method applies to a category is a methodological choice, not a race between modules.`,
      );
    }
    node.module = module;
  }

  const roots: CategoryNode[] = [];

  for (const node of nodes.values()) {
    if (node.parent === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(node.parent);
    if (!parent) {
      throw new EngineError(
        'unknown_parent_category',
        `Category "${node.code}" names parent "${node.parent}", which is not defined. A category ` +
          `cannot hang below something that does not exist.`,
      );
    }
    parent.children.push(node);
  }

  // Paths and depths are derived from the tree, so they cannot contradict it.
  // Walking from the roots also proves the graph is a tree: a node in a cycle is
  // never reached, and the count check below catches it.
  const ordered: CategoryNode[] = [];
  const visit = (node: CategoryNode, parentPath: string | null, depth: number): void => {
    node.path = parentPath === null ? node.name : `${parentPath}${PATH_SEPARATOR}${node.name}`;
    node.depth = depth;
    ordered.push(node);
    for (const child of node.children) {
      visit(child, node.path, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, null, 0);
  }

  if (ordered.length !== nodes.size) {
    const unreached = [...nodes.keys()].filter(
      (code) => !ordered.some((node) => node.code === code),
    );
    throw new EngineError(
      'category_cycle',
      `The category definitions do not form a tree: ${unreached.join(', ')} cannot be reached ` +
        `from any sector root, which means a parent chain loops back on itself.`,
    );
  }

  return {
    roots: () => roots,
    all: () => ordered,
    find: (code) => nodes.get(code),
    get: (code) => {
      const node = nodes.get(code);
      if (!node) {
        throw new EngineError(
          'unknown_category',
          `No category with code "${code}" exists in the category tree. Known categories: ` +
            `${ordered.map((entry) => entry.code).join(', ')}.`,
        );
      }
      return node;
    },
    ancestors: (code) => {
      const chain: CategoryNode[] = [];
      let current = nodes.get(code);
      if (!current) {
        throw new EngineError(
          'unknown_category',
          `No category with code "${code}" exists in the category tree.`,
        );
      }
      while (current.parent !== null) {
        const parent = nodes.get(current.parent);
        if (!parent) {
          break;
        }
        chain.unshift(parent);
        current = parent;
      }
      return chain;
    },
    calculable: () => ordered.filter((node) => node.module !== null),
    moduleFor: (code) => nodes.get(code)?.module ?? null,
    requireModule: (code) => {
      const node = nodes.get(code);
      if (!node) {
        throw new EngineError(
          'unknown_category',
          `No category with code "${code}" exists in the category tree.`,
        );
      }
      if (!node.module) {
        throw new EngineError(
          'no_module_for_category',
          `Category "${code}" (${node.path}) exists in the 2006 Guidelines but no calculation ` +
            `module implements it yet. This is a gap in the calculator, not a value of zero.`,
        );
      }
      return node.module;
    },
  };
}

/**
 * The registry this build uses.
 *
 * One module instance per calculable category. Fuel combustion answers for both
 * 1A4b and 1A3b, but as two instances, so each can declare the fuels and tiers
 * the library actually publishes for it.
 */
export const categoryRegistry: CategoryRegistry = createCategoryRegistry(CATEGORY_DEFINITIONS, [
  createFuelCombustionModule('1A4b'),
  createFuelCombustionModule('1A3b'),
]);
