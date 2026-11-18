# Historical Sheets to MusicXML study

The [canonical MusicXML cutover](musicxml-cutover.md) supersedes this experiment. Current consumers read MusicXML. The historical rhythm-guide profile and commands below describe the pre-cutover study.

This experiment converts a frozen Google Sheets chart and its matching mapping into MusicXML 4.0.
It lets us inspect a complete song before choosing an official intermediate representation.
The Performance Desk still loads the existing compiled song format. Audio execution, storage, and the native ABI are unchanged.

## Design choice

The study combines a readable rhythm score with a complete source archive.
An archive-only document would test preservation but tell us little about notation interoperability.
A score-only document would lose our capture, retained-take, and control semantics.

The chosen design keeps both in one document:

- Standard MusicXML measures, tempo, meter, rehearsal marks, rhythm-guide notes, and text directions provide a readable score.
- Standard `miscellaneous-field` elements retain the validated source and mapping as JSON, with an interpretation profile and SHA-256 hashes.
- The interpretation report distinguishes parsed attacks from text that the exporter preserves without inferring notes.

Review required three independent checks: exact source recovery, official schema validation, and engraving with a separate MusicXML reader.
A custom HTML grid alone cannot establish MusicXML rendering support.
Passing those checks does not establish that a notation editor preserves our metadata when saving a modified score.

## Generate a study

From the repository root, choose a destination directory that does not exist:

```sh
./show-tools chart musicxml \
  --source songs/dance-yrself-clean.source.json \
  --mapping songs/dance-yrself-clean.mapping.json \
  --out-dir /private/tmp/dyc-musicxml-new-study
```

The command validates both inputs and runs the current song compiler before creating the directory.
Stale mappings and unresolved execution diagnostics block export instead of being weakened for this study.
It writes `score.musicxml`, `report.json`, and `index.html`.
An existing destination causes an error; choose another directory for a new run.
The command does not fetch Sheets, start audio, or start the Sheets helper or Chrome CDP.

The current DYC inputs produce eight parts with 218 measures each.
The parts are Vocals, Backup Vocals, Drums & Claps, Cowbell, Bing Bong, Whistle, Bass, and Drums.
Part IDs derive from source label cells, and the score retains the sheet's row order.
Section boundaries and numbered bars come from the compiled chart, including its source-column mapping.

## Inspect the result

The review generated during this study is at `/private/tmp/dyc-musicxml-final/index.html`.
It shows literal source cells and interpreted attack counts, grouped by section, with links to the XML and report.
`/private/tmp/dyc-musicxml-final/engraved.html` shows the independently engraved 17-page score.
These temporary paths are review artifacts, not repository fixtures or deployed pages.

Open `score.musicxml` directly to inspect standard notation and the embedded metadata.
Search for `show-tools:source`, `show-tools:mapping`, and their `-sha256` fields.
The JSON values preserve the parsed source strings, array order, notes, worksheet identity, and mapping policies.
This claim concerns the validated parsed inputs, not the whitespace or property order of their original JSON files.

To reproduce engraving with a separately installed Verovio package:

```sh
npm install --prefix /private/tmp/musicxml-renderer --ignore-scripts --no-audit --no-fund verovio@5.6.0
node --import tsx scripts/render-musicxml-study.ts \
  --study /private/tmp/dyc-musicxml-new-study \
  --verovio-root /private/tmp/musicxml-renderer/node_modules/verovio
```

`--verovio-root` identifies the package directory containing `package.json` and `dist`.
The renderer reads the generated MusicXML and writes SVG pages and `engraved.html` into the study directory.
Generated scores, schemas, renderer packages, and preview images are not committed.

## Interpretation limits

The sheet generally supplies activity, attacks, lyrics, and performance commands rather than a fully notated composition.
The study makes these limits explicit:

- Rhythm-guide parts use one-line staves and unpitched x-noteheads. These do not assert that the original instruments lack pitch.
- Short note glyphs mark attack positions. Their lengths are engraving conventions, not recorded or authored sound durations.
- Rests between attack glyphs fill the notation grid. Text-only measures and blank cells do not prove actual audio silence.
- Main-vocal cells remain text, including lyrics containing letters that also name subdivisions. No melody or syllable timing is inferred.
- Other unrecognized cells remain literal directions. `!` and `!!` are visual markers, not musical dynamics.
- Apostrophes retain sampled-source notation. They do not become staccato marks or score repeats.
- Capture, commit-and-arm, layers, retained variants, prefix playback views, and rotary eligibility remain application metadata.

Explicit rhythm notation uses the approved forward subdivision rule.
For example, `&e3a&` resolves to `1&`, `2e`, `3`, `3a`, and `4&`.
Parenthesized beat anchors do not add an attack on the anchor itself.
The exporter uses 960 divisions per quarter note and scales chart counts to eighth notes in 6/8.
It introduces no MIDI instrument assignments or pitch estimates.

## Determinism and verification

The exporter sorts JSON object keys, preserves array order, uses stable IDs, and writes fixed XML ordering and line endings.
It adds no timestamp, random identifier, machine path, or live catalog assignment.
SHA-256 values identify the deterministic JSON for each validated input.
XML escaping preserves representable source text; forbidden XML 1.0 characters produce a source-coordinate error.

The tests compare repeated output bytes, recover the embedded inputs, check timing and measure counts, and exercise escaping and invalid inputs. The importer, current compiler, CLI and source checks passed 42 tests, and TypeScript passed.
The DYC score also passed the official MusicXML 4.0 XSD and rendered through Verovio 5.6.0 without renderer warnings. The first, middle and last pages were visually inspected.
That verifies this export's schema and rendering interoperability, not a full notation-editor round trip or a MusicXML-to-PE compiler.
The format remains experimental until those adoption questions are reviewed.

The optional [bound Sheets download dialog](sheets-musicxml.md) reuses this converter. Study profile v2 records selected voice label cells in `show-tools:selected-label-cells`; selecting a subset projects score parts while retaining the entire source and mapping. The earlier full-song review artifacts above use profile v1.

Schema validation used `xmllint --nonet --noout --schema musicxml.xsd score.musicxml`, with the [tagged MusicXML 4.0 schema](https://github.com/w3c/musicxml/tree/v4.0/schema) and its `xml.xsd`/`xlink.xsd` imports resolved through a local XML catalog. XML well-formedness tests alone are not schema validation.

The implementation is in [`sheet-musicxml.ts`](../../lib/performance/sheet-musicxml.ts).
The command is in [`import-sheet-musicxml.ts`](../../scripts/import-sheet-musicxml.ts).

MusicXML defines [unpitched percussion notation](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/) and [miscellaneous metadata fields](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/miscellaneous-field/).
Verovio documents its [MusicXML input support](https://book.verovio.org/toolkit-reference/input-formats.html#musicxml).
