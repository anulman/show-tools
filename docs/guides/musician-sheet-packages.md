# Generate and review musician sheet packages

Use one canonical MusicXML export per song to produce writing sheets for Drums, Bass and Keys. Each instrument package contains three song folders, PDF handouts, printable HTML, SVG pages, projected MusicXML, source documents and a regeneration spec. Multiple charted parts keep separate sheets.

## Generate a package

Use the normal project dependencies and a working Python 3.10 or newer with `scripts/musician-pdf-requirements.txt` installed. Confirm `import reportlab, svglib, xml.parsers.expat` succeeds before rendering. An interpreter that starts but cannot import its XML parser cannot render these sheets.

From the repository root, run:

```sh
node --import tsx scripts/build-musician-packages.ts \
  --spec /absolute/path/to/package-spec.json \
  --out-dir /absolute/path/to/new-output-directory \
  --python /absolute/path/to/pdf-python
```

To regenerate an extracted instrument package, use its `drums-spec.json`, `bass-spec.json` or `keys-spec.json` and add `--instrument drums`, `--instrument bass` or `--instrument keys`. The spec resolves source paths relative to its own directory. Choose an output directory that does not exist. A successful run ends with `Created N musician PDFs` and an `index.html` path. A complete output has a root manifest with `status: complete`.

The spec names every source file and its SHA-256. For charted parts it also names the exact row label cell and expected part name. Changed inputs or shifted rows fail before output publication. Review the new chart before updating those bindings. The generator never guesses an instrument from hardware names or substitutes an AF row.

## Use the shared legend

Normal `-` activity is implicit. Whole-bar `!` and `!-` print **Funky**. `!!` prints **Extra funky**. The operator confirmed that `!!!` is a separate, higher-intensity feel; it prints **Higher intensity**. These are musician feel annotations, not inferred dynamics or sampler commands. Managed `AF -` punctuation keeps its own semantics.

A whole-section feel belongs beside the section heading. A change within a section retains its source-bar range. Count-qualified and compound marks remain literal until their meaning is confirmed. Do not invent pitches, chords, grooves, durations or section equivalence.

A blank cell in an existing musician part is an authored not-playing passage and may become a counted rest. A missing musician row is unknown activity. Request an explicit `form` in the spec to obtain full blank staves, sections and lyric cues with an uncharted-part caption. Its hidden MusicXML spacers do not assert silence. It has no invented source row or rest ranges.

Pickups retain their source labels. Chronological ordinal 10 can be source bar 1 after nine pickups. Use source labels in musician-facing ranges and keep ordinals only for coverage checks. Explicit uncounted Lead-in and Tail cells remain labeled boundary cues, not extra numbered measures. The accented `&` remains on the vocal cue line.

## Coordinate the instrument sessions

The coordinator reads fresh Sheets data once, imports it into canonical MusicXML, and freezes the source hashes for all sessions. Instrument sessions read the same inputs, review musical intent, and inspect their actual rendered pages. They do not edit the shared renderer or source Sheet concurrently. Send common legend questions to the coordinator so the operator gets one consistent question.

| Session | Review focus |
|---|---|
| Drums | Entries, fills, compound count marks, pickups, kit identity and rest boundaries. Do not turn a sampled AF drum voice into a human kit part. |
| Bass | Bass clefs, entry counts, feel changes and separate synth/bass layers. Identical activity marks do not establish identical notes. |
| Keys | Separate Pad Synth, Piano and other named parts. Preserve empty writing space; add harmony only from musician-confirmed chord data. |
| Guitar | Distinguish a human arrangement row from an AF sample voice and the PARTS roster. A roster entry alone does not chart a guitar part. |

For every revision, each session returns the source hashes, part rows, page counts, facts, unresolved meanings and actual page checks. State `PASS`, `ISSUES` or `BLOCKED`, with file/page/cell references. Ask concise musical questions and preserve unknown notation in the rough sheets while those questions are open. Do not add explanatory cell notes or repeat draft labels throughout the source.

## Verify before delivery

1. Check every counted source measure appears exactly once in the staff/rest/reference plan. Check source labels separately from ordinal coverage.
2. Check named sections, full-size staves, lyric anchors, entry cues, feel ranges and uncounted boundaries. Repeat headings only at a section change or new page.
3. Render every PDF page to an image. Inspect all pages and zoom into dense sections, long bar labels and boundary cues. Text extraction alone cannot prove there are no collisions.
4. For uncharted forms, check there are no visible authored rests, inferred playing spans or fake source rows.
5. Re-run into another new directory and compare the PDF and ZIP hashes. Keep the source documents, spec and concise review with the delivered package.

Run the focused checks with:

```sh
node --import tsx --test \
  lib/performance/tests/musician-packages.test.ts \
  lib/performance/tests/musician-sheets.test.ts \
  lib/performance/tests/musician-sheet-plan.test.ts \
  lib/performance/tests/musicxml-boundaries.test.ts
```

## First three-song package

The initial live-source review covers Dance Yrself Clean, Drunk Girls and I Can Change. DYC has no Keys arrangement row; ICC has no non-AF Drums row. Those entries use uncharted form worksheets. ICC Bass has Alien Synth and Bass Synth sheets; DG Keys has Pad Synth and Piano; ICC Keys has Pad Synth and Cowbell. This produces twelve part PDFs across nine instrument/song entries. These are source observations for this package, not permanent instrument assignments.

ICC's imported human arrangement is complete for these worksheets. Its unresolved hardware cues still block runtime execution. Generating musician sheets does not approve or deploy a performance program.
