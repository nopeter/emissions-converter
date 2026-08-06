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
import type { CategoryCode, Fuel } from '../data/types';
import {
  calculateFuelCombustionFromQuantity,
  EngineError,
  GASES,
  toCarbonDioxideEquivalent,
} from '../engine';
import type {
  CalorificBasis,
  CarbonDioxideEquivalentResult,
  CombustionResult,
  FuelQuantity,
  GasEmission,
} from '../engine';
import {
  CATEGORIES,
  DEFAULT_GWP_SET_ID,
  defaultUnitForFuel,
  densityUnitsForFuel,
  findCategory,
  findOfferedFuel,
  findUnitById,
  GWP_SETS,
  presetsForUnit,
  technologyOptions,
  unitGroupsForFuel,
} from './catalogue';
import { Co2eTotal } from './Co2eTotal';
import { CALORIFIC_BASIS_LABEL, formatQuantity } from './format';
import { GasResult } from './GasResult';
import { ProvenanceChip } from './ProvenanceChip';
import { Working } from './Working';

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-zinc-600';
const FIELD = 'block w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900';
const FIRST = CATEGORIES[0];

/** The two answers about a heating value, in the order a bill tends to use. */
const CALORIFIC_BASES: CalorificBasis[] = ['net', 'gross'];

type Outcome =
  | { kind: 'empty' }
  | { kind: 'needs_technology' }
  | { kind: 'needs_density' }
  | { kind: 'needs_calorific_basis' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; result: CombustionResult };

/**
 * The gases to display, in the engine's gas order.
 *
 * Biomass CO2 is in `memoItems` and is listed only when the user asks for it.
 * Showing it here never puts it into the CO2-equivalent total: the engine keeps
 * it out of `totalKg` whatever this component displays (CLAUDE.md rule 3).
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
  const [quantityText, setQuantityText] = useState('');
  const [unitId, setUnitId] = useState(defaultUnitForFuel(FIRST.fuels[0].fuel).id);
  const [densityText, setDensityText] = useState('');
  const [densityUnitId, setDensityUnitId] = useState(
    densityUnitsForFuel(FIRST.fuels[0].fuel)[0].id,
  );
  const [calorificBasis, setCalorificBasis] = useState<CalorificBasis | null>(null);
  const [technology, setTechnology] = useState<string | null>(null);
  const [includeBiomass, setIncludeBiomass] = useState(false);
  const [gwpSetId, setGwpSetId] = useState(DEFAULT_GWP_SET_ID);

  const category = findCategory(categoryCode);
  const offered = findOfferedFuel(categoryCode, fuelId);
  const technologies = technologyOptions(fuelId, categoryCode);

  const unit = findUnitById(unitId);
  const unitGroups = offered ? unitGroupsForFuel(offered.fuel) : [];
  const densityChoices = offered ? densityUnitsForFuel(offered.fuel) : [];
  const presets = offered ? presetsForUnit(offered.fuel, unitId) : [];
  // A preset is only "in force" while the figure it filled in is still there.
  // Once the user edits the kilograms, the assumption of a full cylinder is
  // theirs to have overridden, and the chip stops claiming otherwise.
  const activePreset = presets.find((preset) => Number(quantityText) === preset.quantity);

  const needsTechnology = technologies.length > 0;
  const needsDensity = unit?.measures === 'volume';
  const needsCalorificBasis = unit?.measures === 'energy';

  function selectCategory(code: CategoryCode) {
    setCategoryCode(code);
    setTechnology(null);
    const next = findCategory(code);
    if (next && !next.fuels.some((fuel) => fuel.id === fuelId)) {
      selectFuel(next.fuels[0].fuel);
    }
  }

  function selectFuel(fuel: Fuel) {
    setFuelId(fuel.id);
    setTechnology(null);
    // Each fuel is preselected in the unit it is actually sold in, and the
    // answers that belong to the old unit are cleared rather than carried over:
    // a density given for kerosene means nothing once the fuel is natural gas.
    setUnitId(defaultUnitForFuel(fuel).id);
    setDensityUnitId(densityUnitsForFuel(fuel)[0].id);
    setDensityText('');
    setCalorificBasis(null);
  }

  const outcome = useMemo<Outcome>(() => {
    const entered = quantityText.trim();
    if (entered === '') {
      return { kind: 'empty' };
    }
    if (needsTechnology && technology === null) {
      return { kind: 'needs_technology' };
    }
    if (needsDensity && densityText.trim() === '') {
      return { kind: 'needs_density' };
    }
    if (needsCalorificBasis && calorificBasis === null) {
      return { kind: 'needs_calorific_basis' };
    }

    const quantity: FuelQuantity = {
      quantity: Number(entered),
      unit: unitId,
      ...(needsDensity ? { density: { value: Number(densityText), unit: densityUnitId } } : {}),
      ...(needsCalorificBasis && calorificBasis !== null ? { calorificBasis } : {}),
    };

    try {
      const result = calculateFuelCombustionFromQuantity(
        fuelId,
        quantity,
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
  }, [
    calorificBasis,
    categoryCode,
    densityText,
    densityUnitId,
    fuelId,
    needsCalorificBasis,
    needsDensity,
    needsTechnology,
    quantityText,
    technology,
    unitId,
  ]);

  const result = outcome.kind === 'result' ? outcome.result : null;
  const gases = result ? visibleGases(result, includeBiomass) : [];

  // The CO2-equivalent view is derived from the finished result, so switching
  // GWP set re-totals without recalculating any gas (CLAUDE.md rule 4).
  const co2e = useMemo<CarbonDioxideEquivalentResult | null>(
    () => (result === null ? null : toCarbonDioxideEquivalent(result, gwpSetId)),
    [result, gwpSetId],
  );

  // The gas figures and the total each carry their own caveats; the user reads
  // one list, not two.
  const caveats = [...(result?.gaps ?? []), ...(co2e?.gaps ?? [])];

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
      <h1 className="text-sm font-normal leading-relaxed text-zinc-700">
        Converts fuel you burned — by weight, by volume or by energy — into carbon dioxide, methane
        and nitrous oxide, using the 2006 IPCC Guidelines.
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
            onChange={(event) => {
              const next = category?.fuels.find((fuel) => fuel.id === event.target.value);
              if (next) {
                selectFuel(next.fuel);
              }
            }}
            className={`mt-1.5 ${FIELD}`}
          >
            {category?.fuels.map((fuel) => (
              <option key={fuel.id} value={fuel.id}>
                {fuel.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[8rem] flex-1">
              <label htmlFor="quantity" className={LABEL}>
                How much
              </label>
              <input
                id="quantity"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={quantityText}
                placeholder="0"
                onChange={(event) => setQuantityText(event.target.value)}
                aria-describedby={unit?.note ? 'unit-note' : undefined}
                className="mt-1.5 w-full border border-zinc-300 px-3 py-2 text-base tabular-nums text-zinc-900 placeholder:text-zinc-400"
              />
            </div>
            <div className="min-w-[9rem] flex-1">
              <label htmlFor="unit" className={LABEL}>
                In what
              </label>
              <select
                id="unit"
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
                className={`mt-1.5 ${FIELD}`}
              >
                {unitGroups.map((group) => (
                  <optgroup key={group.measures} label={group.label}>
                    {group.units.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label} ({option.symbol})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {presets.length > 0 && (
            <div className="mt-2.5">
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                Common sizes
                <ProvenanceChip provenance="assumed" />
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setQuantityText(String(preset.quantity))}
                    aria-pressed={activePreset?.id === preset.id}
                    className={`border px-2.5 py-1 text-sm ${
                      activePreset?.id === preset.id
                        ? 'border-accent bg-accent text-white'
                        : 'border-dashed border-zinc-500 bg-white text-zinc-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
                {activePreset
                  ? activePreset.note
                  : 'These fill in a weight you can then edit. They assume a full cylinder, which is why they are marked as assumed rather than measured.'}
              </p>
            </div>
          )}

          {unit?.note && (
            <p
              id="unit-note"
              className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-xs leading-relaxed text-zinc-700"
            >
              {unit.note}
            </p>
          )}
        </div>

        {needsDensity && offered && (
          <div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem] flex-1">
                <label htmlFor="density" className={LABEL}>
                  Density
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-600">
                    required
                  </span>
                </label>
                <input
                  id="density"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={densityText}
                  placeholder="0"
                  onChange={(event) => setDensityText(event.target.value)}
                  aria-describedby="density-note"
                  className="mt-1.5 w-full border border-zinc-300 px-3 py-2 text-base tabular-nums text-zinc-900 placeholder:text-zinc-400"
                />
              </div>
              <div className="min-w-[9rem] flex-1">
                <label htmlFor="density-unit" className={LABEL}>
                  Density units
                </label>
                <select
                  id="density-unit"
                  value={densityUnitId}
                  onChange={(event) => setDensityUnitId(event.target.value)}
                  className={`mt-1.5 ${FIELD}`}
                >
                  {densityChoices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.symbol}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p
              id="density-note"
              className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-xs leading-relaxed text-zinc-700"
            >
              A volume only becomes a weight through a density, and no density for{' '}
              {offered.label.toLowerCase()} has been sourced from an authority we can cite, so this
              calculator will not supply one. Look on the supplier&rsquo;s specification sheet, in
              your country&rsquo;s fuel standard, or on the bill itself. Whatever you enter is used
              exactly as given, and every figure in the result moves in proportion to it.
            </p>
          </div>
        )}

        {needsCalorificBasis && (
          <fieldset>
            <legend className={LABEL}>
              Is that a net or a gross figure
              <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-600">
                required
              </span>
            </legend>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-700">
              The Guidelines work in net (lower) heating values, and a gross figure is several
              percent larger for the same fuel. Your bill or meter will say which it uses. The
              calculator will not guess, because guessing would be a silent error rather than a
              visible gap.
            </p>
            <div className="mt-2 space-y-2">
              {CALORIFIC_BASES.map((basis) => (
                <label
                  key={basis}
                  className="flex items-start gap-2.5 text-sm leading-snug text-zinc-900"
                >
                  <input
                    type="radio"
                    name="calorific-basis"
                    value={basis}
                    checked={calorificBasis === basis}
                    onChange={() => setCalorificBasis(basis)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    {CALORIFIC_BASIS_LABEL[basis]}
                    <span className="block text-xs text-zinc-600">
                      {basis === 'net'
                        ? 'Used as entered. This is the basis the Guidelines themselves work in.'
                        : 'Reduced by the rule of thumb in Vol 2 Ch 1 § 1.4.1.2 — about 5 % for coal and oil, 10 % for gas — which is an approximation, and is flagged as one in the result. Fuels those two rules do not cover are refused rather than converted, and the calculator will say so.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

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
          <p className="text-sm text-zinc-600">Enter a quantity to see the result.</p>
        )}

        {outcome.kind === 'needs_technology' && (
          <p className="text-sm text-zinc-800">
            Choose a vehicle technology above to see the result.
          </p>
        )}

        {outcome.kind === 'needs_density' && (
          <p className="text-sm text-zinc-800">
            Enter a density above to see the result. Without one there is no way to turn a volume
            into a weight, and the calculator will not invent a figure.
          </p>
        )}

        {outcome.kind === 'needs_calorific_basis' && (
          <p className="text-sm text-zinc-800">
            Say whether your energy figure is net or gross to see the result.
          </p>
        )}

        {outcome.kind === 'error' && (
          <div role="alert" className="border border-zinc-900 p-3">
            <h2 className="text-sm font-semibold text-zinc-900">This calculation cannot be done</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-800">{outcome.message}</p>
          </div>
        )}

        {result && co2e && (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="sr-only">Result</h2>
              <p className="text-xs tabular-nums text-zinc-600">
                {formatQuantity(result.audit.inputs.quantity)} {result.audit.conversion.unitSymbol}{' '}
                {result.fuelLabel} · {result.categoryCode}
              </p>
            </div>

            <div className="mt-1.5">
              <Co2eTotal result={co2e} />
            </div>

            <div className="mt-3">
              <label htmlFor="gwp-set" className={LABEL}>
                Global warming potentials
              </label>
              <select
                id="gwp-set"
                value={gwpSetId}
                onChange={(event) => setGwpSetId(event.target.value)}
                aria-describedby="gwp-set-note"
                className="mt-1.5 block w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                {GWP_SETS.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.label}
                  </option>
                ))}
              </select>
              <p id="gwp-set-note" className="mt-1.5 text-xs leading-relaxed text-zinc-600">
                The Guidelines do not publish these. Every set here comes from an IPCC assessment
                report, and none has been checked against its primary table yet — which is why the
                total carries an External mark and the gases below do not.
              </p>
            </div>

            <h3 className="mt-6 text-base font-semibold text-zinc-900">The three gases</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
              The primary result. Each gas is measured in its own mass, before any global warming
              potential is applied.
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
                  Show biomass CO₂
                  <span className="block text-xs text-zinc-600">
                    A memo item, off by default. Listing it here does not add it to the total —
                    biomass CO₂ is excluded from inventory totals to avoid double counting.
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

            {caveats.length > 0 && (
              <div className="mt-4 border border-zinc-300 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                  Caveats
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {caveats.map((gap) => (
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

            <Working result={result} gases={gases} co2e={co2e} />
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
