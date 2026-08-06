# Parameter library changelog

Changes to `src/data/parameters.json`. Every change to the library requires a
version bump and an entry here (CLAUDE.md, Architecture).

Two version numbers are tracked:

- `library_version` — the values in the library. Bumped whenever a parameter is
  added, removed or corrected.
- `schema_version` — the shape of the file. Bumped when a consumer would have to
  change to read it.

## library 0.4.0 — schema 4.0.0 — 2026-08-06

Three corrections to 0.3.0, all reviewer decisions. No emission factor,
calorific value or GWP changed.

### LPG takes neither gross-to-net rule

`calorific_basis_family` is removed from liquefied petroleum gases. 0.3.0 gave
it the coal-and-oil rule on the strength of Table 1.1 classifying LPG as a
liquid fuel. That was reading a classification, not a rule: LPG is a gas at
ambient pressure, the Guidelines' two rules of thumb point opposite ways, and
they differ by a factor of two. Neither plainly covers it, so it takes neither
and a gross energy figure for LPG is now refused — the same treatment as
charcoal and firewood.

`calorific_basis_family_note` now appears on all three fuels that are
deliberately in no family, and is what the engine shows the user when it
refuses. A fuel in no family without a note now fails a data-integrity test,
so a future fuel cannot refuse silently.

Nothing else about LPG changed: net energy, mass and volume all still
calculate, and the cylinder presets are untouched.

### The gross-to-net citation is now exact

Both `calorific_basis_conversions` records cite Vol 2 Ch 1, Section 1.4.1.2
("Conversion of Energy Units"), in the text immediately preceding Box 1.1,
rather than the chapter. Both are now `verified: true`.

Verified and approximate are independent claims, and both records still make
the second: the citation has been checked, and the rule is still a rule of
thumb the Guidelines do not quantify. They stay `ipcc_approximate`, still add
an uncertainty term the engine cannot evaluate, and still name Box 1.1 as the
exact algorithm that needs fuel analysis data. The open question about
confirming the section is closed.

### The `mvp` flag is gone (breaking)

Removed from every fuel record and from the `Fuel` type. The calculator offers
every fuel/category combination with a complete, unambiguous factor set, so a
per-fuel flag describing an earlier scope was obsolete and, since 0.3.0
unblocked volume and energy input, actively misleading — it still read false
for kerosene, diesel, petrol and natural gas, all of which work. The open
question about reviewing it is closed with its removal.

No engine or UI code read the flag. `MVP_COMBINATIONS` in the data-integrity
tests is a separate fuel/category list and is unaffected.

## library 0.3.0 — schema 3.0.0 — 2026-08-06

Unit selection. The user picks the unit they bought their fuel in; the engine
converts. No emission factor, calorific value or GWP changed.

### Units (new)

A `units` table of twelve records: the unit the user may enter a quantity in,
and the defined factor that takes it to the engine's canonical unit for its
kind — kilograms for mass, cubic metres for volume, terajoules for energy,
kilograms per cubic metre for density.

| Unit | Factor | To |
| --- | --- | --- |
| g, kg, t | 0.001, 1, 1000 | kg |
| lb | 0.45359237 | kg |
| L, m³ | 0.001, 1 | m³ |
| ft³ | 0.028316846592 | m³ |
| kWh, MJ, GJ | 3.6e-6, 1e-6, 0.001 | TJ |
| kg/L, kg/m³ | 1000, 1 | kg/m³ |

Every one is exact, because every one is a definition: the pound and the foot
by the 1959 international agreement, the rest by the SI. A cubic foot is
0.3048³ m³ exactly.

Gallons and therms are deliberately absent. The US and imperial gallon differ
by about 20 percent and the therm has more than one definition, so offering
either would let someone enter a number that means something other than what
they think it means.

### Conversion provenance classes (new)

Conversions do not use the parameter classes and must never be shown with the
same chip. `conversion_provenance_classes` adds three of their own:

- `exact` — a defined relationship. Adds no uncertainty. A stronger claim than
  `ipcc`, not a weaker one.
- `ipcc_approximate` — the Guidelines' own rule of thumb.
- `user_provided` — a figure the user supplied.

`conversion_provenance_note` records why the two vocabularies are separate.

### Gross-to-net calorific conversion (new)

`calorific_basis_conversions` holds the Vol 2 Ch 1 rules of thumb: the net
calorific value is about 5 percent below the gross for coal and oil, about 10
percent for natural and manufactured gas. Each record stores the percentage the
Guidelines state, not a derived multiplier, so there is one number to be wrong
rather than two that can disagree.

Both are `ipcc_approximate` and neither is verified: the source is cited at
chapter level and the exact section is not yet confirmed. Both notes point at
Box 1.1, which gives an exact algorithm requiring fuel analysis data a
household user will not have.

Fuels gain `calorific_basis_family`. LPG takes the coal-and-oil rule, because
Table 1.1 classifies liquefied petroleum gases as a liquid fuel — recorded on
the fuel with a note, and queued in `open_questions` for a reviewer, since LPG
is a gas at ambient pressure. Charcoal and firewood get no family at all: the
Guidelines publish no rule for solid biomass, where moisture makes the
difference larger and more variable, and the engine refuses rather than
borrowing another family's figure.

### Fuels (breaking)

`common_units` is gone. It mixed real units with pseudo-units
(`cylinder_12.5kg`, `bag_50kg`) and nothing could convert any of them. In its
place:

- `default_unit` — the unit the fuel is preselected in, being the one it is
  actually sold in: kg for LPG, charcoal and firewood; litres for kerosene,
  petrol and diesel; kilowatt-hours for natural gas.
- `presets` — one-tap purchase quantities. Only LPG has any: 12.5, 6 and 3 kg
  cylinders, each `assumed` with a note saying it assumes a full cylinder. The
  charcoal bag preset is not carried over; how much bag weights vary is still
  an open question.
- `calorific_basis_family` and `calorific_basis_family_note`, as above.

### Densities

Still null, still unsourced — no density was added. What changed is what null
now means, recorded in a new `densities_note`: the calculator no longer refuses
volume input outright, it asks the user and labels the result as resting on
their figure. A null value means the engine has no fallback and must ask; it
has never meant the engine may guess.

`unit` on each density record now holds a unit id (`kg_per_litre`,
`kg_per_m3`) rather than a free-text string, so it points at the `units` table.
With `value` null this is the record's most useful field: it names the unit
that fuel's suppliers quote, which is the one the density prompt offers first.

The `blocking` text on each record is rewritten accordingly, and `blocked_by`
on the fuels keeps its name but no longer means the fuel cannot be calculated.

### Open questions

Three added: confirm the exact Vol 2 Ch 1 section behind the 5 and 10 percent
rules; confirm that LPG takes the coal-and-oil rule; and review the `mvp` flag
on kerosene, diesel, petrol and natural gas, which still reads false and is now
misleading. Sourcing densities is reworded — asking the user unblocks the
input, it does not close the gap.

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
