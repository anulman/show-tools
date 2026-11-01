# Focused musician sheets

Musician sheets give each discovered part **not prefixed with `AF -`** a complete five-line staff for handwritten notes, with section and vocal cues for navigation. They complement the onset rhythm guide; they do not turn the arrangement chart into an inferred instrumental transcription.

For the current Dance Yrself Clean chart, the eligible parts are **Bass (A14)** and **Drums (A15)**. AF Drums & Claps remains a separate managed voice and does not become a Drums musician sheet.

## Generate and inspect

```sh
node --import tsx scripts/build-musician-sheets.ts \
  --source songs/dance-yrself-clean.source.json \
  --mapping songs/dance-yrself-clean.mapping.json \
  --out-dir output/pdf/dyc-musician-sheets \
  --pdf --python /private/tmp/musician-pdf/bin/python
```

The output index links each focused part's printable HTML, editable MusicXML, and PDF when PDF generation is enabled. For the DYC preview, open:

- `output/pdf/dyc-musician-sheets/index.html`
- `output/pdf/dyc-musician-sheets/bass-a14.pdf`
- `output/pdf/dyc-musician-sheets/drums-a15.pdf`

The destination directory must not exist. The corresponding `.html` and `.musicxml` files use the same stems. The HTML is self-contained, including its downloadable MusicXML; it does not need adjacent files to print or retrieve the score. PDF generation uses an optional Python environment with pinned ReportLab and svglib dependencies:

```sh
python3 -m venv /private/tmp/musician-pdf
/private/tmp/musician-pdf/bin/python -m pip install -r scripts/musician-pdf-requirements.txt
```

Choose that interpreter with `--python`. Omit `--pdf` when only HTML/SVG and MusicXML are needed. The PDF helper embeds ReportLab's bundled Vera fonts and rejects missing glyphs instead of silently replacing source text. Generated output stays outside Git.

## What the player sees

Each part has all 218 numbered bars, laid out as four bars per full-width staff and seven systems per A4 portrait page. That produces eight pages per DYC part. The final two-bar system contains only the actual remaining bars. Empty arrangement cells stay in the form; long gaps are not compressed into tacet spans.

Every writing staff has five lines and remains clear of generated notes, rests, rhythm slashes, or placeholder patterns. The musician supplies the bass line, groove, or other annotation. The sheet's section and cue lanes provide context without occupying that writing space:

- Section labels and vocal cues appear above the staff. A carried section cue keeps continuation systems identifiable when there is no new cue.
- Literal arrangement marks for the focused part appear below the staff, aligned with their source bar.
- Bar numbers remain visible throughout the full form.

Vocal fragments are navigation cues, not syllable-aligned notation. Their source positions are retained without inferring melody or exact sung timing. In particular, bar 201 retains its vocal cue even though the section is named Instrumental A4. Section names do not determine whether a vocal cue exists.

Marks such as `-`, `!`, and `!!` remain chart text. They do not become sustained notes, accents, or musical dynamics. A blank writing staff is not an assertion that the audio is silent.

## One source, distinct presentations

`lib/performance/musician-sheets.ts` owns `createMusicianSheets({ source, mapping, selectedRows })`. It uses the existing source/compiler boundary and filters the discovered report parts by their managed status. Eligible part identity is based on the source row, not a hardcoded Bass/Drums list.

The outputs share the same focused part, form, source cues, and provenance:

- MusicXML provides editable five-line notation staves and text directions, retaining the application metadata.
- Print-native SVG and HTML provide a fixed worksheet layout with predictable writing room.
- Optional PDFs derive from the same SVG pages through ReportLab and svglib.

The printable worksheet is deliberately a presentation of the shared data. It is **not an independent engraving of the MusicXML file**. MusicXML schema validation and opening that file in a notation program remain separate checks from inspecting the worksheet's PDF or HTML.

Source and mapping metadata preserve the complete chart, including unselected voices, under the same policy as the [MusicXML study](musicxml-study.md). Selection chooses focused output parts; it does not crop bars, renumber cells, or remove their control context.

## Sheets dialog

The [bound Sheets export dialog](sheets-musicxml.md) can offer separate printable sheets and MusicXML for selected non-AF parts alongside its selected-voice export. It uses the same conversion boundary and does not install a second chart parser.

The local package and previews do not establish installation in the operator's spreadsheet. Actual Google authorization, menu execution, and downloads within the real Sheets dialog remain separate verification tasks.

## Verification boundaries

For changes, check that each eligible part includes every bar exactly once, all source cues retain the correct bar and cell, AF rows are excluded, and no inferred notes or dynamics occupy the writing area. Include the lyric-bearing Instrumental A4 section and the last two-bar system in layout review.

MusicXML, SVG, HTML, and selection ordering are deterministic for the same validated inputs. PDF output is intended for viewing and printing; byte-identical PDF metadata is not claimed. Inspect rendered pages for clipping, overlaps, cue readability, and usable handwriting space rather than treating a successful conversion as visual proof.

The combined importer, musician-sheet, Apps Script, compiler and source checks passed 53 tests, and TypeScript passed. Both MusicXML files passed the official MusicXML 4.0 XSD and opened in Verovio 5.6.0 as eight-page parts. The actual PDFs were reopened to verify eight A4 pages, lyric cues and the final section. PDF pages from the beginning, middle and end were rasterized and visually inspected; the full bar sequence is covered by tests.
