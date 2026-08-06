/**
 * The headline CO2-equivalent total, and the set it was computed with.
 *
 * Presentation only: every number here comes from the engine's
 * `CarbonDioxideEquivalentResult`. Nothing is summed, scaled or converted in
 * this file — including the memo figure, which the engine totals separately
 * precisely so that no component has to decide what belongs in a total.
 *
 * Three things this component must never stop doing:
 *
 *  - name the GWP set beside the figure, because a CO2-equivalent number means
 *    nothing without it (CLAUDE.md rule 4);
 *  - show the `external` provenance chip on it, because no GWP is IPCC-derived
 *    (rule 2);
 *  - keep the biomass memo visually outside the total rather than beneath it as
 *    a smaller number of the same kind (rule 3).
 */
import type { CarbonDioxideEquivalentResult } from '../engine';
import { formatPercent, formatQuantity, GAS_FORMULA } from './format';
import { ProvenanceChip } from './ProvenanceChip';

function Uncertainty({ result }: { result: CarbonDioxideEquivalentResult }) {
  const { percent, incomplete } = result.uncertainty;

  if (percent === null) {
    return (
      <p className="text-sm text-zinc-700">
        Uncertainty not quantified
        <span className="block text-xs text-zinc-600">
          No gas contributed a term to the combination.
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

export function Co2eTotal({ result }: { result: CarbonDioxideEquivalentResult }) {
  const { gwpSet } = result;

  return (
    <div className="border border-zinc-900 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-900">
          Total, CO₂-equivalent
          {result.memoItems.length > 0 && (
            <span className="ml-2 font-normal text-zinc-600">excluding biomass CO₂</span>
          )}
        </h2>
        <ProvenanceChip provenance={gwpSet.provenance} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="tabular-nums">
          <span className="text-3xl font-medium leading-none text-zinc-900">
            {formatQuantity(result.totalKg)}
          </span>
          <span className="ml-1.5 text-sm text-zinc-600">kg CO₂-eq</span>
        </p>
        <Uncertainty result={result} />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-700">
        {gwpSet.label}. The 2006 IPCC Guidelines publish no global warming potentials, so this
        figure depends on a source outside the methodology. Change the set below to see how much
        the answer moves.
      </p>

      <ul className="mt-2 space-y-0.5">
        {result.contributing.map((entry) => (
          <li
            key={entry.gas}
            className="flex flex-wrap justify-between gap-x-4 text-xs tabular-nums text-zinc-700"
          >
            <span>
              {GAS_FORMULA[entry.gas]} × {formatQuantity(entry.gwp.value)}
              {entry.gwp.origin !== 'all' && (
                <span className="text-zinc-600"> ({entry.gwp.origin.replace('_', '-')})</span>
              )}
            </span>
            <span className="text-zinc-900">{formatQuantity(entry.co2eKg)} kg CO₂-eq</span>
          </li>
        ))}
      </ul>

      {result.memoItems.map((memo) => (
        <div key={memo.gas} className="mt-3 border-t border-dashed border-zinc-400 pt-2">
          <div className="flex flex-wrap justify-between gap-x-4 text-xs tabular-nums">
            <span className="text-zinc-700">
              Biomass {GAS_FORMULA[memo.gas]} × {formatQuantity(memo.gwp.value)}
              <span className="ml-1.5 font-semibold uppercase tracking-wider text-zinc-600">
                memo
              </span>
            </span>
            <span className="text-zinc-900">{formatQuantity(memo.co2eKg)} kg CO₂-eq</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-700">
            Not added to the total above.{memo.memoReason === null ? '' : ` ${memo.memoReason}`}
          </p>
        </div>
      ))}
    </div>
  );
}
