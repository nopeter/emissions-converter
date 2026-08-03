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
import type { CombustionResult, FactorAudit, GasEmission, UncertaintyResult } from '../engine';
import { formatPercent, formatQuantity, GAS_FORMULA, ROLE_LABEL } from './format';
import { ProvenanceChip } from './ProvenanceChip';

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
              <p className="text-xs text-zinc-900">{skipped.label}</p>
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

export function Working({ result, gases }: { result: CombustionResult; gases: GasEmission[] }) {
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
            <Field label="Mass" value={`${formatQuantity(audit.inputs.massKg)} kg`} />
            <Field label="Category" value={audit.inputs.categoryCode} />
            <Field
              label="Vehicle technology"
              value={audit.inputs.vehicleTechnology ?? 'Not applicable'}
            />
            <Field
              label="Uncertainty of the entered mass"
              value={
                audit.inputs.activityDataUncertaintyPercent === null
                  ? 'Not supplied'
                  : `± ${formatPercent(audit.inputs.activityDataUncertaintyPercent)} %`
              }
            />
          </dl>
        </Section>

        <Section title="Energy conversion">
          <Verbatim>{audit.energyConversion.equation}</Verbatim>
          <p className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs tabular-nums text-zinc-900">
            {audit.energyConversion.workings}
          </p>
        </Section>

        {gases.map((emission) => (
          <GasWorking key={emission.gas} emission={emission} />
        ))}

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
