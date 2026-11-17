# Generate and review musician chart packages

Use canonical MusicXML to produce one writing chart per musician per song. Explicitly select every voice belonging to that musician. Their voice changes and overlaps share one chronological chart, with full-size writing staves, sections and lyric cues. No chart is produced when the musician has no charted part.

## Review without generating PDFs

Run from the repository root:

```sh
node --import tsx scripts/build-musician-packages.ts \
  --spec /absolute/path/to/package-spec-v2.json \
  --out-dir /absolute/path/to/new-preview-directory \
  --format preview
```

Open the resulting `index.html`. Preview mode writes HTML, SVG, projected MusicXML, source documents, provenance, regeneration specs and ZIPs. It never invokes Python or writes a PDF. The completed manifest records `format: preview`; the links expose only formats actually generated.

When PDF generation is wanted, use `--format pdf --python /absolute/path/to/pdf-python`. Use Python 3.10 or newer with `scripts/musician-pdf-requirements.txt` installed. Confirm `import reportlab, svglib, xml.parsers.expat` succeeds first. The same SVG pages supply both formats.

Choose an output directory that does not exist. A successful run ends with an index path. The root manifest has `status: complete` only after every output and the index have been written. Existing output directories are never overwritten.

## Configure musicians explicitly

The standalone handout CLI and Sheets exporter recognize the declared musician namespaces `Drums`, `Bass`, `Keys` and `Guitar`. The exact row name or the `Musician - Voice` convention selects that musician: `Keys - Piano` and `Keys - Pad Synth` share a Keys chart. Other rows, including controls, are not automatically exported. Selection includes only the selected source rows. Package specs below provide explicit bindings instead of depending on this naming convention. Custom musician names require explicit row bindings through `createMusicianChart`.

Version two of the package spec names the song, canonical file and SHA-256, followed by explicit Drums, Bass, Keys and Guitar selections. A musician is either `parts` with exact source row/name bindings, or `none`.

```json
{
  "schemaVersion": 2,
  "songs": [{
    "id": "drunk-girls",
    "musicxml": "drunk-girls.musicxml",
    "sha256": "REPLACE_WITH_THE_REVIEWED_FILE_SHA256",
    "instruments": {
      "drums": { "kind": "parts", "parts": [{ "labelCell": "A18", "name": "Drums" }] },
      "bass": { "kind": "parts", "parts": [{ "labelCell": "A15", "name": "Bass" }] },
      "keys": { "kind": "parts", "parts": [
        { "labelCell": "A16", "name": "Keys - Pad Synth" },
        { "labelCell": "A17", "name": "Keys - Piano" }
      ] },
      "guitar": { "kind": "none" }
    }
  }]
}
```

Resolve source paths relative to the spec file. Review new chart contents before updating hashes or row/name bindings. Missing, renamed, repeated or managed AF rows fail before output publication. A `none` entry appears in the skipped receipt and produces no song directory, worksheet or PDF. An instrument with no included songs produces no ZIP.

Migrate version-one specs by setting `schemaVersion` to `2`, replacing every `form` selection with `none`, and adding an explicit `guitar` selection. Preserve existing `parts` bindings. Multiple voices in one selection now generate one chart. Old `form` specs are rejected, not silently interpreted.

To regenerate an extracted instrument package, use its `<instrument>-spec.json` and add `--instrument drums`, `bass`, `keys` or `guitar`. Extracted specs include only that musician's charted songs.

## Read the shared legend

Normal `-` activity is implicit. Whole-bar `!` and `!-` print **Funky**; `!!` prints **Extra funky**; `!!!` prints **Higher intensity**. These labels describe musician feel. Managed AF punctuation retains its separate performance semantics.

A full sixteenth-note run such as `4e&a` prints **Fill: 4 e & a**. These are specified hits, not an invitation to improvise. A single count followed by `!`, such as `2!`, prints **Fill from 2**. Brackets remain visible as source phrase boundaries. The sheet does not infer a fill duration beyond the confirmed starting count. Other rhythm patterns and unconfirmed compound marks remain literal.

Vocal continuation annotations `-` and `-'`, including equivalent single-prime spellings, are omitted from musician-facing lyrics. Actual lyrics containing apostrophes remain intact. The accented `&` remains on the vocal line. Canonical data and source archives retain the original annotations.

A whole-section feel belongs beside the heading. Internal changes retain their source-bar range. A singleton prints **bar 120**, never **bars 120-120**. Each voice keeps its own feel attribution. Do not invent pitches, chords, grooves or musical equivalence.

Source pickups keep their labels. Ordinal 10 can be source bar 1 after nine pickup measures. An uncounted Tail gets its own final writing bar with its authored hit cue and a final barline. It does not create another numbered source bar or specify how long to sustain the tail.

## Review combined voices

Voice names mark entries, changes and page starts. Simultaneous voices retain separate labeled cues within the same shared writing staff. Count and phrase marks identify within-bar transitions; activity alone does not establish their precise timing.

A condensed musician rest is allowed only when all selected voices rest. One voice resting cannot hide another playing. No repeated section is automatically substituted for a combined chart.

The coordinator freezes source hashes and owns the generator. Instrument sessions review the same inputs, inspect actual pages and return concise facts, open meanings, source references and a `PASS`, `ISSUES` or `BLOCKED` result. Route shared legend questions through the coordinator. Do not add explanatory cell notes or repeated draft labels.

| Session | Review focus |
|---|---|
| Drums | Exact versus freeform fills, entries, pickups, kit identity and all-voice rest boundaries. AF sample voices do not create a human kit part. |
| Bass | Bass clef, entry counts, feel changes and named synth voice changes. Identical activity marks do not establish identical notes. |
| Keys | Pad Synth, Piano and Cowbell transitions and overlaps. Add harmony only from musician-confirmed chord data. |
| Guitar | Human arrangement rows versus AF samples or the PARTS roster. A roster entry does not create a chart. |

## Verify before generating PDFs

1. Check all numbered source measures appear once in the chart's staff/rest plan. Check displayed source labels independently from chronological ordinals.
2. Check all selected voices, fill labels, sections, lyrics, page-start context and feel ranges. Check simultaneous activity before approving condensed rests.
3. Render SVG previews to images and inspect dense voice changes, long headings and the full Tail staff. Check geometry separately from text extraction.
4. Verify skipped musicians produce no files. Check the input MusicXML is unchanged.
5. Generate a second preview into another new directory and compare hashes. Keep source files, specs and concise reviews with the package.

Run the focused checks:

```sh
node --import tsx --test lib/performance/tests/musician-*.test.ts
```

For the initial three-song set, DYC Keys and ICC Drums are omitted. Guitar has no charted row in these inputs. ICC Bass combines Alien Synth and Bass Synth; DG Keys combines Pad Synth and Piano; ICC Keys combines Pad Synth and Cowbell. This yields seven musician/song charts. Missing parts in other songs follow the same `none` rule.

Generating musician charts does not approve performance programs or deploy anything. ICC's unresolved runtime cues remain a separate issue.
