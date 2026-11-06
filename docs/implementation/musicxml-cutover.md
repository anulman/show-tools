# Canonical MusicXML songs

The song document is MusicXML 4.0 with the `show-tools-song-v3` application profile. Sheets is an import boundary. Renderers and performance compilation read the MusicXML document.

The XML reader produces the shared song model in memory. Compiled JSON and native instruction bytes are generated outputs. C++ retains clock advancement, cue execution, capture, mixing, and DSP.

The latest DYC import retains complete multi-bar Cowbell parents and explicit per-bar source views. `clb` commits at the start of its written bar and loops the last completed bar. Standard source notation is preserved, while validated application selections carry source beginning, exclusive end and loop counts. See the [latest import record](dyc-latest-import.md) for the revision and verification.

## Data ownership

Standard MusicXML owns the title, part names, measure structure, meter, tempo, sections, and readable musical indications. The current profile supports the existing fixed-meter charts and onset-only directions. It rejects authored pitches, harmony, repeats, tempo changes, and other unsupported notation instead of discarding them. Standard harmony elements can carry chord symbols or Nashville numerals after the importer and profile gain that capability.

The `show-tools:performance` field carries the versioned application instructions that MusicXML does not define. These include capture operations, take retention, layers, selection views, rotation windows and normalized visual activity. Sheets notation is interpreted once at ingestion. Typed stage records include section eligibility, emphasis and exact accent offsets; Video never reparses archived cell text. Standard positioned words carry musician activity, feel ranges and vocal annotations. Consumers validate these instructions before execution. A notation editor that removes the application metadata cannot silently produce an executable song.

The optional `show-tools:source` and `show-tools:mapping` fields retain the original parsed import data for audit and migration. Consumers do not reconstruct the song from those archives. Removing both archives must leave the compiled song and chart report unchanged.

Source references identify cells for diagnostics and Sheets following. The music and performance instructions remain in the MusicXML document.

## Verify the migration

Run the independent DYC check from the repository root.

```sh
node --import tsx scripts/verify-musicxml-cutover.ts
```

Pass a MusicXML path as the optional argument to inspect another copy of the migrated DYC document.

```sh
node --import tsx scripts/verify-musicxml-cutover.ts songs/dance-yrself-clean.musicxml
```

The verifier compares the generated result with values captured before the cutover at commit `4eb0569`. The original baseline was captured before the Sheets converter and musician renderer changed. The committed script retains its hashes.

The check covers the complete compiled song except the source and mapping digests, which identify the new storage representation. It also compares native instruction bytes and every SVG page byte for Bass and Drums. DYC retains all 218 bars, 62 cues, 12 takes, four Bass pages, and five Drums pages.

Run the input-authority and corruption tests separately.

```sh
node --import tsx --test lib/performance/tests/musicxml-cutover.test.ts
```

These tests remove the raw import archives and edit the standard title, tempo, and part name. They also check missing application instructions, malformed XML, DTDs, unsupported notation and versions, and conflicting displayed commands.

## Limits of the verification

Equal native instruction bytes prove that this migration presents the same song program to the existing native engine. They do not remeasure microphone quality or physical hardware behavior.

Schema validation and independent notation rendering are separate checks. A successful import into a notation editor does not prove that saving from that editor preserves application instructions. Each supported editor needs an explicit save-and-reimport check before it becomes an authoring path.

The profile distinguishes onset indications and writing-space placeholders from authored notes and rests. Printed glyphs must not acquire new playback meaning during interchange.

## Commands

Compile or inspect a canonical song.

```sh
./show-tools chart inspect songs/dance-yrself-clean.musicxml
./show-tools chart compile --musicxml songs/dance-yrself-clean.musicxml --out /private/tmp/dyc-derived.json
./show-tools chart encode --song /private/tmp/dyc-derived.json --out /private/tmp/dyc-derived.pfp
node --import tsx scripts/build-musician-sheets.ts --musicxml songs/dance-yrself-clean.musicxml --out-dir output/pdf/dyc-musician-sheets-musicxml --pdf --python /private/tmp/show-tools-musician-pdf/bin/python
```

The handout destination must be new. Omit `--pdf` when the optional Python dependencies are unavailable. The output includes printable HTML, SVG, MusicXML part projections and optional PDFs. Part projections cannot load as complete executable songs.

`show-tools chart fetch --url URL --mapping MAPPING.json --out SONG.musicxml` imports current public Sheets values and notes. Workbook import and `chart musicxml --source SOURCE.json --mapping MAPPING.json --out-dir NEW_DIRECTORY` are other ingestion paths. Only these boundaries interpret Sheets notation.

`scripts/migrate-song-musicxml.ts --out-dir NEW_DIRECTORY` reproduces the three initial conversions from retained JSON migration inputs. It never overwrites canonical documents. Apply future XML edits to the canonical file; a Sheets reimport is an explicit new revision.

## Song voice metadata

The optional `show-tools:voices` field contains validated effects, characters and qualified song bindings. The Practice download includes saved local assignments for a document loaded for editing. A staged imported document retains its own assignments during download. Imports isolate colliding local voice IDs so unrelated songs keep their settings. SQLite/IndexedDB remains the editor's library and backup format. Character artwork and recorded PCM remain external assets.

Semantic hashes change when music, application instructions or song voice metadata changes. They ignore source/mapping audit archives and UI selection. Unsupported text offsets and unknown profile fields, including nested voice metadata, reject rather than disappear during rewriting. The source view is limited to 4096 rows, 16384 columns and two million populated cells to bound worksheet projections.

## Proposed harmony authoring language

The current profile does not accept harmony or pitched notation yet. A next profile can add a `Harmony` row and an explicit `Key` declaration. One proposed bar cell is `1:Cmaj7; 3:G/B`, meaning Cmaj7 on count 1 and G over B on count 3. This example is illustrative, not DYC's harmony. The Sheets adapter would validate these names and write standard MusicXML `harmony` elements at exact offsets. A Nashville view would derive from the same harmony and key instead of introducing another independent chord row. Implement and test that grammar before using it in production charts.

## Cutover verification record (initial implementation)

The complete suite passed 438 tests with two explicit skips. TypeScript, the UI build, offline layout validation and official MusicXML 4.0 schema validation passed. The migrated DYC program passed native/WASM checks at 44.1 and 48 kHz. The migration verifier preserved every compiled semantic field apart from the new content digests, native instruction bytes and all nine writing-page SVGs. The generated PDFs were rendered and visually checked.

The browser access host was unavailable during the final run, so live browser interaction was not verified. The Google Apps Script installer was rebuilt locally and was not installed in the operator spreadsheet. The decision trail is [musicxml-cutover-decisions.tsv](musicxml-cutover-decisions.tsv). Independent Astra review found a MusicXML cursor-order loss case; the reader now rejects that unsupported order and its regression test passes.


## Canonical import completion

The completed integration uses profile `show-tools-song-v3`. All bundled modules read the canonical document; timing-only songs retain blank-program practice, while any unresolved authored commands keep audio blocked. Musician planning and Video preparation consume normalized annotations rather than reparsing Sheets glyphs. Video CLIs accept a self-contained song, with an optional external catalog used only when no portable snapshot exists.

The complete repository suite passed 570 tests with two explicit skips. The Video suite passed 53 tests. TypeScript, both UI builds, offline layout checks and official MusicXML 4.0 schema validation passed. DYC native/WASM conformance passed at 44.1 and 48 kHz; compiled meaning, native bytes and all nine writing-page SVGs remain unchanged. Regenerated Bass and Drums PDFs were rendered and visually checked.

A fresh public DYC fetch succeeded with 468 cell notes and the complete used range `A1:HL55`. Its native bytes match the committed chart exactly. The strict frozen-baseline verifier additionally compares the original source range `A1:HL30`, so its full compiled-object hash is intentionally specific to that frozen input. Workbook matching recognizes the exact Google `m d` display format for date-coerced rhythm cells without accepting mismatched values.

Regression coverage includes complete-chart bounds, dynamically added voice rows, unknown nested metadata, archive removal, standard feel and vocal-offset edits, canonical repeat timing, timing-only loading, and embedded-catalog CLI portability. The Apps Script package is rebuilt locally; installation and Google authorization remain operator work. External notation-editor save/reimport remains unverified.

## Explicit jiggle inactivity migration

Profile v3, compiled schema 6, mapping version 6 and native packet 6 name the jiggle release interval `inactivityBeats`. A nonzero accepted motion keeps the effect active for that full count-beat interval after the latest motion, capped by its authored window. This deliberately replaces v2's next-grid release; .25 now means a full quarter count of inactivity. Standard MusicXML notation and every other performance instruction remain unchanged.

The normal reader rejects v2 documents. Migrate them explicitly to a new file:

```sh
node --import tsx scripts/migrate-jiggle-musicxml.ts INPUT.musicxml --out NEW.musicxml
```

The command validates the legacy application metadata, renames the rotation interval in performance data and optional mapping archive, and rewrites through the strict current reader/writer. It retains standard music, source archives, annotations and portable voice metadata while recalculating canonical semantic digests. Repeating the migration on a current canonical file produces identical bytes; the CLI refuses to overwrite an existing output.

The original cutover hashes at `4eb0569` remain frozen. The verifier explicitly projects compiled schema 6's interval field back to its historical name/schema and native packet 6's version marker back to 5 before comparing those original hashes. Every other compiled field, native instruction value and musician-page hash remains pinned. Separate tests establish v3 rejection/migration and the native timing tests establish the intentionally changed release behavior. This historical projection is verification only and is never an executable compatibility loader.
