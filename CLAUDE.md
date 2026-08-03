# CLAUDE.md

Project context for Claude Code. Read this fully before making changes.

## What this project is

A public web calculator that converts an individual's or household's activity data
(fuel purchased, distance driven, appliances owned) into greenhouse gas emissions,
using the methods and default factors of the **2006 IPCC Guidelines for National
Greenhouse Gas Inventories**.

The product's differentiator is **transparency**, not convenience. Every number shown
to a user must be traceable to a cited source and must carry an uncertainty range.
A competitor can copy the arithmetic. They cannot easily copy a fully cited,
uncertainty-carrying parameter library.

## Scope

The target is a **full implementation of the 2006 IPCC Guidelines** across all four
sectors — Energy, IPPU, AFOLU and Waste — built sector by sector, not a fixed
handful of categories.

**Energy (Volume 2) comes first, all six chapters.** Only then IPPU (Vol 3), AFOLU
(Vol 4) and Waste (Vol 5).

Categories that exist in the Guidelines but that no module implements yet are
visible as unimplemented. An unimplemented category is a gap in the calculator; it
is never reported as zero.

Simple mode is a preset layer over the full engine — a preset only pre-fills
inputs. It must never introduce a separate calculation path.

Two open methodological questions travel with this scope, and are to be answered
when those sectors are built rather than treated as reasons to exclude them: the
Vol 4 (AFOLU) methods are producer-side, and Vol 5's First Order Decay is
inherently multi-year and national. Downscaling either to one household needs a
stated, defensible basis before it ships.

## Non-negotiable domain rules

These are correctness requirements, not preferences. Violating them makes the
product wrong, not just imperfect.

1. **Provenance on every parameter.** No numeric constant may be hard-coded inside
   calculation code. Every factor lives in the parameter library with a `source`
   field naming the IPCC volume, chapter and table, or is explicitly flagged as
   external or assumed.

2. **Three provenance classes, always visible in the UI:**
   - `ipcc` — read directly from the 2006 IPCC Guidelines
   - `external` — sourced elsewhere (grid emission factors, fuel densities, GWP values)
   - `assumed` — our own estimate or simplification
   The UI must visually distinguish these. Never present an `assumed` value as if
   it were IPCC-derived.

3. **Biomass CO2 is a memo item, not a total.** CO2 from firewood, charcoal and
   other biofuels is reported separately and is NOT added to the headline total
   (Vol 2 Ch 2: reported as information items, excluded from sectoral and national
   totals to avoid double counting). CH4 and N2O from the same combustion ARE
   included in the total. This distinction must survive every refactor.

4. **Gases before CO2-equivalent.** Always compute and display kg CO2, kg CH4 and
   kg N2O separately. CO2-eq is a derived view. The GWP set used must be named in
   the UI and must be user-switchable, because the 2006 Guidelines reference GWPs
   from the IPCC Third Assessment Report but do not themselves publish the table.
   GWP values are therefore `external`, never `ipcc`.

5. **Uncertainty is propagated, not discarded.** Combine uncertainties using
   Approach 1 from Vol 1 Ch 3:
   - Multiplication (Eq 3.1): U_total = sqrt(U1^2 + U2^2 + ... + Un^2)
   - Addition (Eq 3.2): U_total = sqrt(sum((Ui * xi)^2)) / sum(xi)
   Where an IPCC 95% confidence interval is asymmetric and we treat it as symmetric,
   that simplification must be recorded in the parameter record.

6. **Tiers mean data specificity, not effort.** Tier 1 = IPCC default factors.
   Tier 2 = country-specific factors or user-measured quantities. Tier 3 =
   technology-disaggregated (e.g. distinct CH4/N2O factors for uncontrolled vs
   catalyst vs post-1995 petrol vehicles). Never relabel a UI convenience as a tier.

7. **Never invent a factor.** If a value is needed and not available, surface a
   clearly-labelled gap in the UI. Do not fill it from general knowledge, and do
   not silently substitute a similar fuel.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS
- No backend, no database, no authentication. Static site only.
- No browser storage APIs unless explicitly requested; keep state in React.
- Deployed as a Render Static Site: build `npm run build`, publish `dist`.

Do not add dependencies without a stated reason in the PR description. Prefer
zero-dependency solutions for anything the standard library can do.

## Architecture

- `src/data/` — the parameter library. Versioned JSON. The most valuable asset
  in the repo. Changes here require a version bump and a changelog entry. Every
  record declares the IPCC `category` it belongs to, and the library is indexable
  by category code.
- `src/engine/` — pure calculation functions. No React, no DOM, no I/O.
  Every function returns both a result and an audit trail (inputs, factor used,
  factor source, equation applied).
- `src/engine/registry.ts` — the IPCC category tree: code, name, sector, volume,
  parent, and the module that calculates it. A category's full name is derived
  from its ancestors and must match the parameter library's own label for it.
- `src/engine/module.ts` — the interface every category's method implements:
  `declareInputs()`, `availableTiers()`, `calculate(inputs, tier, options)`.
- `src/ui/` — React components. Presentation only. Must not contain arithmetic.
- `src/engine/__tests__/` — fixture tests, hand-calculated from the Guidelines.

The engine must be testable without a browser.

Adding a category means adding a definition to the registry, a module that
implements the interface, and its parameters — not editing the interface or the
user interface. A module declares its inputs and the tiers it supports; both are
derived from what the parameter library actually publishes, so a new factor
arriving in the library is what makes a tier available.

## Testing

Before opening any PR that touches `src/engine/` or `src/data/`, run the test
suite and ensure it passes. Add a fixture test for every new calculation path,
with the expected value derived by hand from the cited IPCC table and the
derivation written in a comment.

Reference fixture (must always pass):
150 kg LPG, residential.
NCV 47.3 TJ/Gg (Vol 2 Ch 1 Table 1.2) -> 0.007095 TJ
CO2 EF 63 100 kg/TJ (Vol 2 Ch 2 Table 2.5) -> 447.7 kg CO2
CH4 EF 5 kg/TJ -> 0.0355 kg CH4
N2O EF 0.1 kg/TJ -> 0.00071 kg N2O

## Working agreement

- One PR per task, scoped small enough that a non-technical reviewer can judge it
  from the deployed preview.
- Every PR description must state, in plain English: what changed, what a reviewer
  should click to verify it, and any assumption introduced.
- If a task is ambiguous, ask rather than guess. Wrong emission numbers are worse
  than a delayed feature.
- Do not refactor beyond the scope of the task.
- CI must be green before any PR is merged.

## Blockers

- If a git push, network request, or dependency install fails with a permissions
  or authentication error, stop immediately and report it as a blocker. Do not
  investigate commit signing, git hooks, or git internals — those are almost never
  the cause. Do not attempt workarounds.
- If an expected file, dependency, or piece of context is missing, stop and report
  it as a blocker. Never search outside this git repository — not Google Drive, not
  the web, not other local paths — to locate project files. This repository is the
  single source of truth.

## Audience and constraints

Primary users are non-specialists, mobile-first, often on slow connections in
West Africa. Optimise for first meaningful result in under 60 seconds, with no
account required. Keep the JavaScript bundle small.

## Out of scope for now

- User accounts, payments, and any server-side feature
