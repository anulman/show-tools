# Focused musician sheets

Musician sheets give every discovered non-`AF -` part a separate handout with writing staves, section labels and vocal cues. The generator now condenses inactive passages and redundant headings while retaining the complete chronological chart.

For Dance Yrself Clean, the current compact handouts are **Bass: four A4 pages** and **Drums: five A4 pages**, down from eight each. Both represent all 218 bars. The five-line writing staff remains the same physical size; savings come from counted rests and less repeated text.

## Generate and inspect

```sh
node --import tsx scripts/build-musician-sheets.ts \
  --source songs/dance-yrself-clean.source.json \
  --mapping songs/dance-yrself-clean.mapping.json \
  --out-dir output/pdf/dyc-musician-sheets-annotated \
  --pdf --python /private/tmp/show-tools-musician-pdf/bin/python
```

Choose a directory that does not exist. Each part gets a PDF, self-contained printable HTML, SVG pages and MusicXML. The index links the handouts and repeat-candidate report. Current review files are under `output/pdf/dyc-musician-sheets-annotated/`; earlier versions remain available for comparison.

Every page repeats a vertically centered part/song heading, preserving the bold part name and lighter song title. Meter/tempo and the current bar range form a tightly spaced block at the upper right. Page numbering appears as “Page X of Y” at the bottom right. The printed template omits instructional header/footer sentences.

PDF generation uses an optional isolated Python environment:

```sh
python3 -m venv /private/tmp/show-tools-musician-pdf
/private/tmp/show-tools-musician-pdf/bin/python -m pip install -r scripts/musician-pdf-requirements.txt
```

Choose that interpreter with `--python`. Without `--pdf`, generation needs only the normal project dependencies. The PDF helper uses ReportLab and svglib, embeds bundled Vera fonts, and rejects missing glyphs. Generated artifacts are ignored by Git.

## Condensation rules

A section heading appears when the section changes or a page starts. It is not repeated on every continuation staff on the same page. Lyrics sit alongside their actual bar numbers and wrap inside that bar’s cue area. Lyrics are not carried onto later pages; section headings provide continuation context. The confirmed `-3] &` vocal shorthand shows count 3 followed by an accented `&` at count 3-and, exclusively on the vocal cue line. MusicXML records these as vocal words at count offsets 2 and 2.5, without inventing notes.

Literal blank arrangement cells mean the musician is not playing. An entirely blank section becomes a counted rest, including a short outro. Within a mixed section, runs of at least four blank bars can condense. Rest groups stop at section changes and new vocal cues. `-`, `!`, `!!`, subdivision patterns and all other nonblank text never become rests.

Active material keeps up to four bars per full-size writing staff. Pickups remain visible even in a mostly inactive section: DYC Drums retains bars 76 and 160, and the marked entry at 203-205. The final two bars remain an explicit two-bar rest, not invented measures 219-220. The final page is rebalanced when an ending section would otherwise be split unnecessarily.

Normal playing (`-`) is implicit. Whole-bar `!` and `!-` become “Funky”; `!!` becomes “Extra funky.” Contiguous ranges are bounded by sections, clipped to each page, and labeled once at their first visible bar. The same page spans appear in MusicXML. Compound beat-qualified instrument tokens retain their literal source spelling pending a confirmed interpretation.

Each condensed row retains the original cells. Expanding staff rows, counted-rest ranges and approved reference ranges must reconstruct every bar exactly once and in order. Source text, notes, mappings and original coordinates remain in the MusicXML metadata.

## Confirmed section references

The generator finds exact repeated chart-cue sequences and writes `repeat-candidates.json`. These are suggestions, not assertions that the played music repeats: identical activity marks can conceal different bass lines or drum parts.

`reuse-template.json` starts with matching source/mapping hashes and an empty `references` array. To enable a musician-confirmed reference, add an entry with:

| Field | Meaning |
|---|---|
| `partLabelCell` | The focused musician's source label cell. |
| `sectionStartBar` | First bar of the later section to abbreviate. |
| `sourceSectionStartBar` | First bar of the earlier, fully written section. |
| `equivalence` | The literal `musician-confirmed`, after confirming the playing is equivalent. |

Pass that file with `--reuse PATH.json`. References must cover complete equal-length sections of at least four bars, have identical nonempty chart-cue sequences, point backward, and target a section that remains fully written. Duplicate references, chains, changed cues and stale source/mapping hashes are rejected. Confirmed references are a distinct type from unapproved candidates.

A reference prints “As [section], bars X-Y”, its duration, and the next bar to continue at. Destination lyric cues remain visible. It does not create D.S./D.C./coda traversal or change the song's playback order. No DYC musical-equivalence decisions are built in; the default output applies zero references. The operator's equivalence choice remains separate from automated chart matching.

## Data and presentation

`lib/performance/musician-sheet-plan.ts` owns rest/reference planning and validation. `musician-annotations.ts` derives readable feel ranges and confirmed vocal annotations; `musician-sheets.ts` paginates and renders the shared plan. It reuses the existing compiler/discovery report; it does not infer pitched notes, grooves or musical dynamics.

MusicXML retains every chronological measure and represents counted rests with standard `multiple-rest` notation. The v3 musician-sheet profile adds `show-tools:condensation` metadata containing rest ranges, approved references and the candidate audit. Active writing bars use hidden engraving spacers, while literal blank source bars use visible measure rests. This notation describes the authored musician part; it is not an observation of PE playback and does not trigger Play or Stop.

Print-native SVG/HTML and PDFs are worksheet presentations of that plan, not independent engravings of MusicXML. MusicXML validation and opening in another reader remain separate checks. Selection still projects focused non-AF parts while retaining the complete source archive, including unselected voices.

The [Sheets dialog](sheets-musicxml.md) uses the compact default for selected non-AF parts. Its optional reuse configuration is currently a CLI workflow. No live Google installation, authorization or iframe-download verification follows from local package checks.

## Verification

Run musician-sheet and planner tests alongside the existing exporter, Sheets, compiler and source tests. Verify exact expanded coverage, unchanged staff dimensions, same-page heading suppression, counted-rest boundaries, pickup protection, vocal cues inside rests, explicit reference continuation points, and invalid-reference rejection. Render and inspect the PDFs as well as validating the XML.

The combined checks passed 64 tests and TypeScript. Both compact MusicXML files validated against MusicXML 4.0 and independently rendered in Verovio 5.6.0 as four- and five-page parts. The PDFs were reopened to verify A4 geometry, page counts and lyric cues; beginning and ending pages were rasterized and visually inspected. Default reference lists remain empty.
