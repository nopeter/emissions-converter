/**
 * One gas, as a headline figure.
 *
 * Gases are never combined here. CO2, CH4 and N2O each get their own row with
 * their own uncertainty, provenance and tier, and there is no CO2-equivalent
 * anywhere in this component (CLAUDE.md rule 4).
 *
 * The uncertainty is shown as the combined percentage the engine returns from
 * Approach 1, which is the form Vol 1 Ch 3 works in. It is deliberately not
 * converted into kilogram bounds: that would mean deriving a new emissions
 * figure inside a React component, and `src/ui/` must not contain arithmetic.
 * The published interval behind each individual parameter is shown in full in
 * the working panel.
 */
import type { Provenance } from '../data/types';
import type { GasEmission } from '../engine';
import { formatPercent, formatQuantity, GAS_FORMULA, GAS_NAME } from './format';
import { ProvenanceChip } from './ProvenanceChip';

/** The provenance classes behind this figure, in the order they were applied. */
function provenanceClasses(emission: GasEmission): Provenance[] {
  const seen: Provenance[] = [];
  for (const factor of emission.audit.factors) {
    if (!seen.includes(factor.provenance)) {
      seen.push(factor.provenance);
    }
  }
  return seen;
}

function UncertaintyLine({ emission }: { emission: GasEmission }) {
  const { percent, incomplete } = emission.uncertainty;

  if (percent === null) {
    return (
      <p className="text-sm text-zinc-700">
        Uncertainty not quantified
        <span className="block text-xs text-zinc-600">
          No term had a published confidence interval.
        </span>
      </p>
    );
  }

  return (
    <p className="text-sm tabular-nums text-zinc-800">
      ± {formatPercent(percent)} %
      <span className="ml-1 text-xs tabular-nums text-zinc-600">
        {incomplete ? '95 % interval, lower bound' : '95 % interval'}
      </span>
    </p>
  );
}

export function GasResult({ emission }: { emission: GasEmission }) {
  return (
    <div className="border-t border-zinc-200 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900">
          {GAS_FORMULA[emission.gas]}
          <span className="ml-2 font-normal text-zinc-600">{GAS_NAME[emission.gas]}</span>
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {provenanceClasses(emission).map((provenance) => (
            <ProvenanceChip key={provenance} provenance={provenance} />
          ))}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Tier {emission.tier}
          </span>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="tabular-nums">
          <span className="text-3xl font-medium leading-none text-zinc-900">
            {formatQuantity(emission.kg)}
          </span>
          <span className="ml-1.5 text-sm text-zinc-600">kg</span>
        </p>
        <UncertaintyLine emission={emission} />
      </div>

      {emission.memoItem && emission.memoReason !== null && (
        <p className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-xs leading-relaxed text-zinc-700">
          {emission.memoReason}
        </p>
      )}

    </div>
  );
}
