/**
 * The calculator page.
 *
 * One page, no routing, no submit button: the result is a pure function of the
 * form state, recomputed as the user types. State lives in React only — no
 * browser storage.
 *
 * Presentation only. Every number on this page comes out of the engine; this
 * component chooses what to show and in what order, and computes nothing.
 */
import { useMemo, useState } from 'react';
import { parameters } from '../data';
import type { CategoryCode } from '../data/types';
import { calculateFuelCombustion, EngineError, GASES } from '../engine';
import type { CombustionResult, GasEmission } from '../engine';
import {
  CATEGORIES,
  conversionNote,
  findCategory,
  findOfferedFuel,
  technologyOptions,
} from './catalogue';
import { formatQuantity } from './format';
import { GasResult } from './GasResult';
import { Working } from './Working';

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-zinc-600';
const FIRST = CATEGORIES[0];

type Outcome =
  | { kind: 'empty' }
  | { kind: 'needs_technology' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; result: CombustionResult };

/**
 * The gases to display, in the engine's gas order.
 *
 * Biomass CO2 is in `memoItems` and is left out unless the user asks for it.
 * Nothing is summed: the list is the total (CLAUDE.md rules 3 and 4).
 */
function visibleGases(result: CombustionResult, includeBiomass: boolean): GasEmission[] {
  const shown = includeBiomass
    ? [...result.totalContributing, ...result.memoItems]
    : [...result.totalContributing];
  return shown.sort((a, b) => GASES.indexOf(a.gas) - GASES.indexOf(b.gas));
}

export function App() {
  const [categoryCode, setCategoryCode] = useState<CategoryCode>(FIRST.code);
  const [fuelId, setFuelId] = useState(FIRST.fuels[0].id);
  const [massText, setMassText] = useState('');
  const [technology, setTechnology] = useState<string | null>(null);
  const [includeBiomass, setIncludeBiomass] = useState(false);

  const category = findCategory(categoryCode);
  const offered = findOfferedFuel(categoryCode, fuelId);
  const technologies = technologyOptions(fuelId, categoryCode);
  const note = offered ? conversionNote(offered.fuel) : null;

  function selectCategory(code: CategoryCode) {
    setCategoryCode(code);
    setTechnology(null);
    const next = findCategory(code);
    if (next && !next.fuels.some((fuel) => fuel.id === fuelId)) {
      setFuelId(next.fuels[0].id);
    }
  }

  function selectFuel(id: string) {
    setFuelId(id);
    setTechnology(null);
  }

  const needsTechnology = technologies.length > 0;

  const outcome = useMemo<Outcome>(() => {
    const entered = massText.trim();
    if (entered === '') {
      return { kind: 'empty' };
    }
    if (needsTechnology && technology === null) {
      return { kind: 'needs_technology' };
    }
    try {
      const result = calculateFuelCombustion(
        fuelId,
        Number(entered),
        categoryCode,
        technology === null ? {} : { vehicleTechnology: technology },
      );
      return { kind: 'result', result };
    } catch (error) {
      // The engine throws rather than returning a result with a hole in it, so
      // there is nothing partial to fall back to: show what it said and stop.
      if (error instanceof EngineError) {
        return { kind: 'error', message: error.message };
      }
      throw error;
    }
  }, [categoryCode, fuelId, massText, needsTechnology, technology]);

  const result = outcome.kind === 'result' ? outcome.result : null;
  const gases = result ? visibleGases(result, includeBiomass) : [];
  const showingBiomass = result !== null && includeBiomass && result.memoItems.length > 0;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
      <h1 className="text-sm font-normal leading-relaxed text-zinc-700">
        Converts a mass of fuel burned into carbon dioxide, methane and nitrous oxide, using the
        2006 IPCC Guidelines.
      </h1>

      <form className="mt-6 space-y-5" onSubmit={(event) => event.preventDefault()}>
        <fieldset>
          <legend className={LABEL}>Where the fuel was burned</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {CATEGORIES.map((option) => (
              <div key={option.code}>
                <input
                  type="radio"
                  id={`category-${option.code}`}
                  name="category"
                  value={option.code}
                  checked={option.code === categoryCode}
                  onChange={() => selectCategory(option.code)}
                  className="peer sr-only"
                />
                <label
                  htmlFor={`category-${option.code}`}
                  className="flex h-full cursor-pointer items-center justify-center border border-zinc-300 px-3 py-2 text-center text-sm text-zinc-800 peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2"
                >
                  {option.label}
                </label>
              </div>
            ))}
          </div>
          {category && (
            <p className="mt-1.5 text-xs tabular-nums text-zinc-600">
              {category.code} · {category.fullLabel}
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor="fuel" className={LABEL}>
            Fuel
          </label>
          <select
            id="fuel"
            value={fuelId}
            onChange={(event) => selectFuel(event.target.value)}
            className="mt-1.5 block w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {category?.fuels.map((fuel) => (
              <option key={fuel.id} value={fuel.id}>
                {fuel.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="mass" className={LABEL}>
            Mass burned
            <span className="sr-only"> in kilograms</span>
          </label>
          <div className="mt-1.5 flex items-baseline gap-2">
            <input
              id="mass"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={massText}
              placeholder="0"
              onChange={(event) => setMassText(event.target.value)}
              aria-describedby={note ? 'mass-note' : undefined}
              className="w-full max-w-[11rem] border border-zinc-300 px-3 py-2 text-base tabular-nums text-zinc-900 placeholder:text-zinc-400"
            />
            <span aria-hidden="true" className="text-sm text-zinc-600">
              kg
            </span>
          </div>

          {note && offered && (
            <p
              id="mass-note"
              className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-xs leading-relaxed text-zinc-700"
            >
              {offered.label} is normally sold by {note.soldBy}, not by weight. This calculator
              works in kilograms, and no density has been sourced for it yet ({note.densityId}), so
              you will need to work out the mass of what you bought yourself. Nothing here converts
              it for you.
            </p>
          )}
        </div>

        {needsTechnology && (
          <fieldset>
            <legend className={LABEL}>
              Vehicle technology
              <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-600">
                required
              </span>
            </legend>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-700">
              The Guidelines publish a separate methane and nitrous oxide factor for each of these
              (Tier 3). Until you choose, there is no single factor to apply, and the calculator
              will not choose for you.
            </p>
            <div className="mt-2 space-y-2">
              {technologies.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2.5 text-sm leading-snug text-zinc-900"
                >
                  <input
                    type="radio"
                    name="vehicle-technology"
                    value={option.value}
                    checked={technology === option.value}
                    onChange={() => setTechnology(option.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    {option.label}
                    {!option.labelled && (
                      <span className="block text-xs text-zinc-600">
                        No plain-English label is published for this technology.
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </form>

      <div aria-live="polite" className="mt-8">
        {outcome.kind === 'empty' && (
          <p className="text-sm text-zinc-600">Enter a mass to see the result.</p>
        )}

        {outcome.kind === 'needs_technology' && (
          <p className="text-sm text-zinc-800">
            Choose a vehicle technology above to see the result.
          </p>
        )}

        {outcome.kind === 'error' && (
          <div role="alert" className="border border-zinc-900 p-3">
            <h2 className="text-sm font-semibold text-zinc-900">This calculation cannot be done</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-800">{outcome.message}</p>
          </div>
        )}

        {result && (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold text-zinc-900">
                {showingBiomass ? 'Total including biomass CO₂' : 'Total emissions'}
              </h2>
              <p className="text-xs tabular-nums text-zinc-600">
                {formatQuantity(result.massKg)} kg {result.fuelLabel} · {result.categoryCode}
              </p>
            </div>

            {showingBiomass && (
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-700">
                Not an IPCC inventory total — biomass CO₂ is excluded from national totals to avoid
                double counting.
              </p>
            )}

            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
              Three separate gases, not combined. Adding them together needs a global warming
              potential set, which this version does not apply.
            </p>

            {result.memoItems.length > 0 && (
              <label className="mt-3 flex items-start gap-2.5 text-sm leading-snug text-zinc-900">
                <input
                  type="checkbox"
                  checked={includeBiomass}
                  onChange={(event) => setIncludeBiomass(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
                <span>
                  Include biomass CO₂
                  <span className="block text-xs text-zinc-600">
                    Reported separately as a memo item. Off by default.
                  </span>
                </span>
              </label>
            )}

            <div className="mt-4">
              {gases.map((emission) => (
                <GasResult key={emission.gas} emission={emission} />
              ))}
            </div>

            {gases.some((emission) => emission.uncertainty.incomplete) && (
              <p className="border-t border-zinc-200 pt-3 text-xs leading-relaxed text-zinc-600">
                A lower bound means at least one uncertainty term had no published range and was
                left out of the combination, so the real uncertainty is larger than shown. The
                working names every term that was left out, and why.
              </p>
            )}

            {result.gaps.length > 0 && (
              <div className="mt-4 border border-zinc-300 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                  Caveats
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {result.gaps.map((gap) => (
                    <li
                      key={`${gap.parameterId ?? gap.kind}-${gap.gas ?? ''}`}
                      className="text-xs leading-relaxed text-zinc-800"
                    >
                      {gap.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Working result={result} gases={gases} />
          </section>
        )}
      </div>

      <footer className="mt-8 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-600">
        Parameter library {parameters.library_version}, updated {parameters.updated}. Factors from
        the {parameters.methodology}.
      </footer>
    </main>
  );
}
