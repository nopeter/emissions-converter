# Parameter library changelog

Changes to `src/data/parameters.json`. Every change to the library requires a
version bump and an entry here (CLAUDE.md, Architecture).

Two version numbers are tracked:

- `library_version` — the values in the library. Bumped whenever a parameter is
  added, removed or corrected.
- `schema_version` — the shape of the file. Bumped when a consumer would have to
  change to read it.

## library 0.2.1 — schema 2.0.0 — 2026-08-05

No parameter value changed. The open question about how the engine should choose
between the AR6 fossil and non-fossil methane GWPs is answered — it picks by the
fuel's biomass flag — so the entry now asks a reviewer to confirm that rule
rather than to decide it.

## library 0.2.0 — schema 2.0.0 — 2026-08-05

### Global warming potential sets

Replaced the three GWP sets with five, all 100-year horizon: SAR, TAR, AR4, AR5,
AR6. CO2 is 1 in every set.

| Set | CH4 | N2O |
| --- | --- | --- |
| SAR (1995) | 21 | 310 |
| TAR (2001) | 23 | 296 |
| AR4 (2007) | 25 | 298 |
| AR5 (2013) | 28 | 265 |
| AR6 (2021) | 29.8 fossil / 27.0 non-fossil | 273 |

Every set is `provenance: "external"` and `verified: false`. The 2006 IPCC
Guidelines do not publish GWP values, so no set may ever be classed `ipcc`. The
new library-level `gwp_sets_note` records why, citing Vol 1 Ch 4 footnote 3 —
the Guidelines used the SAR 100-year GWPs to derive their own key category
thresholds and worked examples — and Vol 1 Ch 8 Annex 2, whose reporting tables
require the compiler to specify the source of the GWP factors used. Each set
carries the same citation in its own `note`.

Each set gains `source_precision: "report_level"`: `source` names the assessment
report and year, but the exact table reference is not yet confirmed. That is why
no set is verified. Confirming the table references is tracked in
`open_questions`.

The previous AR6 entry carried a single CH4 value of 27.9, which is neither of
the values AR6 publishes. AR6 gives a higher 100-year GWP for fossil methane
than for non-fossil methane, so the set now carries both, flagged by
`fossil_split: true`. The distinction is load-bearing for this calculator rather
than academic: charcoal and firewood are non-fossil.

### Schema (breaking)

`GwpSet.values` changed from a `Record<Gas, number>` to an array of named
`GwpValue` records — `{ id, gas, origin, label, value }` — so that a set can
publish more than one value for a gas without the second one being an unlabelled
special case. `origin` is `all`, `fossil` or `non_fossil`.

New fields: `fossil_split` and `source_precision` on each set, `gwp_sets_note`
on the library.

Nothing outside `src/data/` read `gwp_sets` at the time of this change, so no
engine or UI code was affected. There is still no CO2-equivalent calculation;
this change is data only.

## library 0.1.0 — schema 1.0.0 — 2026-08-02

Initial parameter library: net calorific values, fuels, emission factors,
densities (all deliberately unsourced and null), and three GWP sets, covering
residential (1A4b) and road transport (1A3b) combustion.
