/**
 * The provenance chip: IPCC, External or Assumed.
 *
 * CLAUDE.md rule 2 requires the three classes to be visually distinct and an
 * `assumed` value never to read as IPCC-derived. The three chips differ in
 * fill, border style and wording, so the distinction does not rest on colour
 * alone; the accent is not used here, because provenance is information, not
 * an interactive element.
 */
import { parameters } from '../data';
import type { ConversionProvenance, Provenance } from '../data/types';
import { CONVERSION_PROVENANCE_LABEL, PROVENANCE_LABEL } from './format';

const CHIP =
  'inline-flex shrink-0 items-center border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider';

const STYLES: Record<Provenance, string> = {
  // Solid, like a printed stamp: read from the Guidelines themselves.
  ipcc: 'border-zinc-900 bg-zinc-900 text-white',
  // Outlined: sourced, but from outside the methodology.
  external: 'border-zinc-600 bg-white text-zinc-800',
  // Dashed and unfilled-looking: our own estimate, deliberately provisional.
  assumed: 'border-dashed border-zinc-600 bg-zinc-100 text-zinc-900',
};

export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`${CHIP} ${STYLES[provenance]}`} title={parameters.provenance_classes[provenance]}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

/**
 * The chip for a unit conversion, which is a different kind of claim.
 *
 * A conversion is not an emission parameter and must not borrow the parameter
 * chips: `exact` is a stronger claim than `ipcc`, and a density the user typed
 * in is neither `external` nor `assumed` — nobody assumed it, they knew it, or
 * thought they did. So these are rounded where the parameter chips are square,
 * as well as differently worded, and the two never appear in the same row.
 */
export function ConversionChip({ provenance }: { provenance: ConversionProvenance }) {
  const styles: Record<ConversionProvenance, string> = {
    // Solid: a definition, the strongest thing on the page.
    exact: 'border-zinc-900 bg-zinc-900 text-white',
    // Outlined: the Guidelines' own rule of thumb, sourced but approximate.
    ipcc_approximate: 'border-zinc-600 bg-white text-zinc-800',
    // Dashed: the user's own figure, unverifiable from here.
    user_provided: 'border-dashed border-zinc-600 bg-zinc-100 text-zinc-900',
  };

  return (
    <span
      className={`${CHIP} rounded-full ${styles[provenance]}`}
      title={parameters.conversion_provenance_classes[provenance]}
    >
      {CONVERSION_PROVENANCE_LABEL[provenance]}
    </span>
  );
}
