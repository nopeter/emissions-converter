/**
 * "Show the working": the engine's audit trail, rendered.
 *
 * Every equation, source string, skip reason and symmetrisation note below is
 * printed verbatim from the audit trail. This component does not paraphrase a
 * source, summarise a reason, or describe a parameter in its own words — if
 * the text is wrong, it is wrong in the engine or the parameter library, which
 * is where it can be fixed once.
 *
 * The panel is a plain <details>, so it costs no JavaScript and works from the
 * keyboard without any handling of our own.
 */
import type { ReactNode } from 'react';
import type {
  CarbonDioxideEquivalentResult,
  CombustionResult,
  ConversionAudit,
  ConversionStep,
  FactorAudit,
  GasEmission,
  UncertaintyResult,
} from '../engine';
import {
  CALORIFIC_BASIS_LABEL,
  formatPercent,
  formatQuantity,
  GAS_FORMULA,
  GWP_ORIGIN_LABEL,
  ROLE_LABEL,
  SKIP_REASON_LABEL,
} from './format';
import { ConversionChip, ProvenanceChip } from './ProvenanceChip';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A monospaced block for text that must be read exactly as written. */
function Verbatim({ children }: { children: ReactNode }) {
  return (
    <p className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-800">
      {children}
    </p>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-zinc-100 py-1 last:border-b-0">
      <dt className="text-xs text-zinc-600">{label}</dt>
      <dd className="text-xs tabular-nums text-zinc-900">{value}</dd>
    </div>
  );
}

function Factor({ factor }: { factor: FactorAudit }) {
  return (
    <div className="mt-3 border border-zinc-200 p-2.5 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold text-zinc-900">{factor.label}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <ProvenanceChip provenance={factor.provenance} />
          {factor.tier !== undefined && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Tier {factor.tier}
            </span>
          )}
        </div>
      </div>

      <p className="mt-1 tabular-nums">
        <span className="text-base font-medium text-zinc-900">{formatQuantity(factor.value)}</span>
        <span className="ml-1 text-xs text-zinc-600">{factor.unit}</span>
      </p>

      <dl className="mt-2">
        <Field label="Parameter" value={factor.parameterId} />
        <Field label="Role" value={ROLE_LABEL[factor.role]} />
        <Field
          label="95 % interval"
          value={
            factor.ci95Low === null || factor.ci95High === null
              ? 'None published'
              : `${formatQuantity(factor.ci95Low)} to ${formatQuantity(factor.ci95High)} ${factor.unit}`
          }
        />
        <Field
          label="Checked against source"
          value={factor.verified ? 'Yes' : 'No — not yet verified'}
        />
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-700">
        <span className="text-zinc-600">Source: </span>
        {factor.source ?? 'No source recorded on this parameter.'}
      </p>

      {factor.note !== undefined && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{factor.note}</p>
      )}
    </div>
  );
}

/**
 * One step of the unit conversion, printed as arithmetic.
 *
 * Every step shows its factor, where the factor comes from and the sum with the
 * numbers in, whether it is a definition or a figure the user typed. A
 * conversion the reader cannot check is a conversion they have to trust, and
 * this product's whole claim is that they should not have to.
 */
function Step({ step }: { step: ConversionStep }) {
  return (
    <div className="mt-3 border border-zinc-200 p-2.5 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold text-zinc-900">{step.label}</p>
        <ConversionChip provenance={step.provenance} />
      </div>

      <p className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
        {step.workings}
      </p>

      <dl className="mt-2">
        <Field label="Factor" value={`${formatQuantity(step.factor)} ${step.factorUnit}`} />
        <Field
          label="Adds uncertainty"
          value={step.approximate ? 'Yes — an approximation' : 'No — a defined conversion'}
        />
        <Field
          label="Checked against source"
          value={step.verified ? 'Yes' : 'No — not yet verified'}
        />
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-700">
        <span className="text-zinc-600">Source: </span>
        {step.source ?? 'No source recorded on this step.'}
      </p>

      {step.note !== null && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{step.note}</p>
      )}
    </div>
  );
}

/** How what the user typed became something Eq 2.1 can be applied to. */
function ConversionWorking({ conversion }: { conversion: ConversionAudit }) {
  return (
    <>
      <p className="text-[11px] leading-relaxed text-zinc-700">{conversion.note}</p>

      <dl className="mt-2">
        <Field
          label="Entered"
          value={`${formatQuantity(conversion.quantity)} ${conversion.unitSymbol}`}
        />
        <Field
          label="Used as"
          value={`${formatQuantity(conversion.resultValue)} ${conversion.resultUnit}`}
        />
        {conversion.calorificBasis !== null && (
          <Field label="Heating value" value={CALORIFIC_BASIS_LABEL[conversion.calorificBasis]} />
        )}
        <Field
          label="Net calorific value used"
          value={conversion.usesCalorificValue ? 'Yes' : 'No — energy was entered directly'}
        />
      </dl>

      <div className="mt-2">
        {conversion.steps.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </div>
    </>
  );
}

function Uncertainty({ uncertainty }: { uncertainty: UncertaintyResult }) {
  return (
    <>
      <Verbatim>{uncertainty.equation}</Verbatim>

      <p className="mt-2 text-xs tabular-nums text-zinc-900">
        Combined:{' '}
        {uncertainty.percent === null
          ? 'not quantified — no term could be included'
          : `± ${formatPercent(uncertainty.percent)} %`}
        {uncertainty.incomplete && uncertainty.percent !== null && ' (lower bound)'}
      </p>

      {uncertainty.terms.length > 0 && (
        <dl className="mt-2">
          {uncertainty.terms.map((term) => (
            <Field
              key={term.parameterId}
              label={term.label}
              value={`± ${formatPercent(term.percent)} %`}
            />
          ))}
        </dl>
      )}

      {uncertainty.terms
        .filter((term) => term.symmetrisation !== undefined)
        .map((term) => (
          <p
            key={`${term.parameterId}-symmetrisation`}
            className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-[11px] leading-relaxed text-zinc-700"
          >
            {term.symmetrisation}
          </p>
        ))}

      {uncertainty.skipped.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            Terms left out
          </p>
          {uncertainty.skipped.map((skipped) => (
            <div key={skipped.parameterId} className="mt-1.5">
              <p className="text-xs text-zinc-900">
                {skipped.label}
                <span className="ml-1.5 text-[11px] text-zinc-600">
                  {SKIP_REASON_LABEL[skipped.reason]}
                </span>
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-700">{skipped.note}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function GasWorking({ emission }: { emission: GasEmission }) {
  return (
    <div className="mt-5 border-t border-zinc-200 pt-4">
      <h4 className="text-sm font-semibold text-zinc-900">
        {GAS_FORMULA[emission.gas]}
        {emission.memoItem && (
          <span className="ml-2 text-xs font-normal text-zinc-600">memo item</span>
        )}
      </h4>

      <div className="mt-2">
        <Verbatim>{emission.audit.equation}</Verbatim>
        <p className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
          {emission.audit.workings}
        </p>
      </div>

      <Section title="Factors applied">
        {emission.audit.factors.map((factor) => (
          <Factor key={factor.parameterId} factor={factor} />
        ))}
      </Section>

      <Section title="Uncertainty">
        <Uncertainty uncertainty={emission.uncertainty} />
      </Section>
    </div>
  );
}

/**
 * How the CO2-equivalent total was reached.
 *
 * Every gas is shown with the GWP applied to it and why that GWP rather than
 * another, because for AR6 "why that one" is a real question with two possible
 * answers. The memo item appears here too, with its own arithmetic, so that a
 * reader can see it was computed and then deliberately left out of the sum
 * rather than never computed at all.
 */
function Co2eWorking({ co2e }: { co2e: CarbonDioxideEquivalentResult }) {
  const entries = [...co2e.contributing, ...co2e.memoItems];

  return (
    <div className="mt-5 border-t border-zinc-200 pt-4">
      <h4 className="text-sm font-semibold text-zinc-900">CO₂-equivalent</h4>

      <div className="mt-2">
        <Verbatim>{co2e.audit.definition}</Verbatim>
      </div>

      <Section title="Global warming potential set">
        <dl>
          <Field label="Set" value={co2e.gwpSet.label} />
          <Field label="Parameter" value={co2e.gwpSet.id} />
          <Field label="Horizon" value={`${formatQuantity(co2e.gwpSet.horizonYears)} years`} />
          <Field
            label="Splits methane by origin"
            value={co2e.gwpSet.fossilSplit ? 'Yes — fossil and non-fossil' : 'No — one value'}
          />
          <Field
            label="Checked against source"
            value={co2e.gwpSet.verified ? 'Yes' : 'No — not yet verified'}
          />
          <Field
            label="Source precision"
            value={
              co2e.gwpSet.sourcePrecision === 'report_level'
                ? 'Report named, exact table not yet confirmed'
                : (co2e.gwpSet.sourcePrecision ?? 'Not recorded')
            }
          />
        </dl>

        <p className="mt-2 text-[11px] leading-relaxed text-zinc-700">
          <span className="text-zinc-600">Source: </span>
          {co2e.gwpSet.source ?? 'No source recorded on this set.'}
        </p>

        <p className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-[11px] leading-relaxed text-zinc-700">
          {co2e.audit.libraryNote}
        </p>
      </Section>

      <Section title="Each gas">
        {entries.map((entry) => (
          <div key={entry.gas} className="mt-3 first:mt-0">
            <p className="text-xs font-semibold text-zinc-900">
              {GAS_FORMULA[entry.gas]}
              {entry.memoItem && (
                <span className="ml-2 font-normal text-zinc-600">memo item — not in the total</span>
              )}
            </p>
            <p className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
              {entry.audit.workings}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-700">
              {entry.gwp.originReason}
              {entry.gwp.origin !== 'all' && ` Applies to ${GWP_ORIGIN_LABEL[entry.gwp.origin]} sources.`}
            </p>
            <Factor factor={entry.audit.gwp} />
          </div>
        ))}
      </Section>

      <Section title="Total">
        <p className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
          {co2e.audit.workings}
        </p>
        {co2e.memoItems.length > 0 && (
          <p className="mt-2 border-l-2 border-zinc-300 pl-2.5 text-[11px] leading-relaxed text-zinc-700">
            Biomass CO₂ ({formatQuantity(co2e.memoTotalKg)} kg CO₂-eq) is absent from this sum by
            design, not by omission.
          </p>
        )}
      </Section>

      <Section title="Uncertainty of the total">
        <Uncertainty uncertainty={co2e.uncertainty} />
      </Section>
    </div>
  );
}

export function Working({
  result,
  gases,
  co2e,
}: {
  result: CombustionResult;
  gases: GasEmission[];
  co2e: CarbonDioxideEquivalentResult | null;
}) {
  const { audit } = result;

  return (
    <details className="mt-6 border-t border-zinc-200">
      <summary className="cursor-pointer py-3 text-sm font-medium text-accent marker:text-zinc-400">
        Show the working
      </summary>

      <div className="pb-6">
        <Section title="Inputs">
          <dl>
            <Field label="Fuel" value={audit.inputs.fuelId} />
            <Field
              label="Quantity"
              value={`${formatQuantity(audit.inputs.quantity)} ${audit.conversion.unitSymbol}`}
            />
            <Field
              label="Mass"
              value={
                audit.inputs.massKg === null
                  ? 'Not applicable — energy was entered'
                  : `${formatQuantity(audit.inputs.massKg)} kg`
              }
            />
            <Field label="Category" value={audit.inputs.categoryCode} />
            <Field
              label="Vehicle technology"
              value={audit.inputs.vehicleTechnology ?? 'Not applicable'}
            />
            <Field
              label="Uncertainty of the entered quantity"
              value={
                audit.inputs.activityDataUncertaintyPercent === null
                  ? 'Not supplied'
                  : `± ${formatPercent(audit.inputs.activityDataUncertaintyPercent)} %`
              }
            />
          </dl>
        </Section>

        <Section title="Unit conversion">
          <ConversionWorking conversion={audit.conversion} />
        </Section>

        <Section title="Energy conversion">
          {audit.energyConversion === null ? (
            <p className="text-[11px] leading-relaxed text-zinc-700">
              None. The energy was entered directly, so no net calorific value was applied and no
              mass was ever calculated. That is why the uncertainty below is smaller than it would
              be for the same fuel entered by weight: the calorific value is not a term in it.
            </p>
          ) : (
            <>
              <Verbatim>{audit.energyConversion.equation}</Verbatim>
              <p className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
                {audit.energyConversion.workings}
              </p>
            </>
          )}
        </Section>

        {gases.map((emission) => (
          <GasWorking key={emission.gas} emission={emission} />
        ))}

        {co2e && <Co2eWorking co2e={co2e} />}

        <Section title="Parameter library">
          <dl>
            <Field label="Methodology" value={audit.library.methodology} />
            <Field label="Library version" value={audit.library.libraryVersion} />
            <Field label="Schema version" value={audit.library.schemaVersion} />
            <Field label="Updated" value={audit.library.updated} />
          </dl>
        </Section>
      </div>
    </details>
  );
}
