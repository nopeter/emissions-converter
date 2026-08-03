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
import type { Provenance } from '../data/types';
import { PROVENANCE_LABEL } from './format';

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
    <span
      className={`inline-flex shrink-0 items-center border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${STYLES[provenance]}`}
      title={parameters.provenance_classes[provenance]}
    >
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}
