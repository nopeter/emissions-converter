# Changelog

Changes to the parameter library (`src/data/parameters.json`). Every entry names
the schema version, the library version, and what changed. A change that alters a
value, a source or a provenance class must say so explicitly, because those are
the numbers users see.

## Library 0.2.0 — schema 1.1.0 — 2026-08-03

**Schema change only. No value, source, provenance class or uncertainty interval
was altered.**

- Added a `category` field to every record that lacked one, so the library can be
  read by the same IPCC category tree the engine's modules are registered
  against.
  - Net calorific values, fuels and densities are filed at `1A` (fuel
    combustion). They apply wherever a fuel is burned, not to one subcategory of
    it, so they are filed at the branch rather than repeated below it.
  - GWP sets are filed at `null`. They apply to every gas from every source;
    filing them under one code would be false precision.
  - Emission factors already carried a `category` and are unchanged.
- Bumped `schema_version` to 1.1.0 (a field was added) and `library_version` to
  0.2.0.

## Library 0.1.0 — schema 1.0.0 — 2026-08-02

- Initial library: net calorific values (Vol 2 Ch 1 Table 1.2), fuel combustion
  emission factors for residential (1A4b) and road transport (1A3b), unsourced
  fuel densities recorded as visible gaps, and GWP sets marked `external` pending
  primary verification.
