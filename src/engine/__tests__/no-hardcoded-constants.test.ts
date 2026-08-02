/**
 * No numeric emission or calorific constant may appear in engine code
 * (CLAUDE.md rule 1). Every such value comes from the parameter library.
 *
 * This test reads the engine's own source. It strips comments and string
 * literals, then checks that every remaining numeric literal is one of a short
 * list of structural constants — SI prefix definitions, a percentage scale, a
 * comparison tolerance and so on. None of those is a measured quantity, and none
 * could be revised by a better source.
 *
 * If this fails, the fix is almost never to widen the allowlist. It is to move
 * the number into `src/data/parameters.json` with a provenance class and a
 * source.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const engineDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Numeric literals engine code is allowed to contain, with why.
 *
 *   0, 1, 2   array/arithmetic structure, and the halving of an interval width
 *   100       percent scale
 *   1e3, 1e9  SI: grams per kilogram, grams per gigagram
 *   1e-9      relative tolerance for the symmetry comparison
 *   12        significant digits kept in audit strings
 */
const ALLOWED_LITERALS = new Set(['0', '1', '2', '100', '1e3', '1e9', '1e-9', '12']);

function sourceFiles(): string[] {
  return readdirSync(engineDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(engineDir, name));
}

/** Remove comments and string/template literals so only code remains. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' ');
}

/** Numeric literals, ignoring digits that are part of an identifier. */
function numericLiterals(code: string): string[] {
  const pattern = /(?<![A-Za-z0-9_$.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  return code.match(pattern) ?? [];
}

describe('src/engine contains no emission or calorific constants', () => {
  const files = sourceFiles();

  it('finds engine source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s uses only structural numeric literals', (file) => {
    const literals = numericLiterals(stripCommentsAndStrings(readFileSync(file, 'utf8')));
    const unexpected = [...new Set(literals)].filter(
      (literal) => !ALLOWED_LITERALS.has(literal),
    );
    expect(unexpected).toEqual([]);
  });

  it('does not contain any value published in the parameter library', () => {
    // A belt-and-braces check aimed squarely at the failure this rule exists to
    // prevent: an emission factor or calorific value copied into code. Values
    // that double as ordinary arithmetic (0, 1, 2, 100, round powers of ten,
    // and the structural literals above) are excluded, because a match on those
    // would say nothing.
    const distinctive = new Set<string>();
    for (const value of parametersValues()) {
      const text = String(value);
      if (Math.abs(value) > 10 && !Number.isInteger(Math.log10(value)) && !ALLOWED_LITERALS.has(text)) {
        distinctive.add(text);
      }
    }
    expect(distinctive.size).toBeGreaterThan(0);

    for (const file of files) {
      const literals = new Set(numericLiterals(stripCommentsAndStrings(readFileSync(file, 'utf8'))));
      for (const literal of literals) {
        expect(distinctive.has(literal)).toBe(false);
      }
    }
  });
});

/** Every numeric value the parameter library publishes. */
function parametersValues(): number[] {
  const raw = readFileSync(join(engineDir, '..', 'data', 'parameters.json'), 'utf8');
  const library = JSON.parse(raw) as Record<string, unknown>;
  const values: number[] = [];

  const walk = (node: unknown): void => {
    if (typeof node === 'number') {
      values.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };

  walk(library);
  return values;
}
