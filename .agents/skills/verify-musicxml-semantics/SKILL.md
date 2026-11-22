---
name: verify-musicxml-semantics
description: Verify canonical MusicXML semantic preservation over a complete finite input grammar. Use when changing the MusicXML reader, writer, compiler, semantic digest, sheet ingestion, normalized annotations, or saved song voice metadata.
---

# Verify canonical MusicXML semantics

Run `node --import tsx verification/musicxml/verify.ts` from the repository root. Install the locked dependencies with `npm ci --ignore-scripts` if needed. Run `node_modules/.bin/tsc --project verification/musicxml/tsconfig.json --noEmit` for the verification sources.

Read `verification/musicxml/README.md` before interpreting a result. The finite domain has 624 score inputs and 7,488 canonical cases. Separate supplemental checks cover a declared pickup/Tail timeline, 32 boundary-annotation cases, one three-level feel witness, and 6,173 zero-to-two-binding configurations, including 1,814 accepted and 4,359 rejected duplicate/overlap assignments. A second supplemental domain checks 2,786 valid three-to-six-binding tables and representative authored-list permutations, including actual native encoding. It uses the actual TypeScript implementation, not a handwritten parser model. A pass is bounded exhaustive verification plus that concrete witness, not a proof for arbitrary XML or the audio engine.

## Covered source and sync record

`verification/musicxml/coverage.json` records exact file hashes and source sync commit `46d87f67751e116aae0f37f7fe47217694688cfa`. The original finite domain and all six existing source mutants remain unchanged. Six supplemental mutants cover boundary writing, endpoint offsets, higher-intensity normalization, feel identity, numeric decoding and XML-only entity admission. The separate cue verifier covers the terse grammar. Runtime tuner selection, pitch observations and periodic source analysis remain outside this verifier. It covers:

- `lib/performance/musicxml-model.ts`: parsed annotation types, including optional boundary cues and the distinct Higher intensity feel.
- `lib/performance/musicxml-song.ts`: `semanticDigest`, `writeMusicXmlSong`, `readMusicXmlSong`, and `compileMusicXmlSong`.
- `lib/performance/sheet-musicxml.ts`: `importSheetMusicXml`.
- `lib/performance/compiled-song.ts`: source compilation, arrangement parsing, executable program validation, and schemas used by the reader.
- `lib/performance/sheet-cues.ts`: the versioned cue parser; its separate finite domain is covered by `verify-sheet-cues`.
- `lib/performance/song-source.ts`, `columns.ts`, `score-xml.ts`, `sheet-musical-annotations.ts`, and `sheet-stage-notation.ts`: source and normalized score construction.
- `lib/voice-catalog/sheet-voices.ts` and `model.ts`: score-part discovery and saved voice metadata validation.
- `input-bindings.ts` and `model.ts`: validated canonical binding metadata and its pure physical/row registries.
- `compiled-native.ts` and `wasm-abi.ts`: actual encoded PFI1 table preservation and numeric packet constants. The synchronous decode-and-encode adapter has separate unit and CLI witnesses; the finite native-table property reaches its shared private encoder through the existing public encoder.
- `package-lock.json`: exact external dependencies.

## Interpret failures

The runner verifies source hashes, runs the full Cartesian domain, binding domains and supplemental notation witnesses, and requires thirteen actual-source mutants in a temporary copy to fail their named properties. Each restored witness must pass afterward. Mutant acceptance requires the exact structured property-failure result emitted by a named assertion, exit code 1, and empty stderr. It never changes production files or connects to live services.

`BOUND_CASE_FAILURE` names an input whose current implementation violates the stated contract. Read its cause and replay that score input from `domain.ts`. Preserve the evidence and report the finding. Do not change product code or weaken the rule unless the task authorizes the corresponding behavior change.

`SOURCE_DRIFT` means covered code changed since the sync record. It is not proof of a product bug. Review the covered diff against the recorded commit, then run `node --import tsx verification/musicxml/check.ts` to check the current implementation without the old hash gate. Compare the new behavior with the plain-language properties. Reviewers must distinguish an intended meaning change from a parser or model error.

If the new behavior is intended, update the grammar, expectations, mutation witnesses, and proposed coverage hashes together. Compute hashes from the actual files. Run the complete `verify.ts` command against that proposed record. Advance the sync commit in both this skill and `coverage.json` only after the full domain and all thirteen real-source mutation challenges pass and the verification still describes the code at that commit. Commit the verified record with the corresponding change. `/maintain-formal-verification-skill` provides the broader drift-review workflow.

`MUTANT_SOURCE_SHAPE_DRIFT`, `MUTANT_SURVIVED`, or `WRONG_MUTANT_FAILURE` means the implementation-coupling evidence is incomplete. Inspect the real source and repair the witness. Do not count an unrelated exception or the mere presence of an assertion string as a pass.

## Intent and bounds

Preserve round-trip program/report/voice meaning, archive independence, displayed-action agreement, and semantic identity changes. The 6/8 cases count six eighth-note chart and BPM beats; the grammar makes no phase assumption about pedal onset.

The current domain fixes four pad parts and varies one reference row plus optional live vocals, one to three bars, two meters, three per-bar tokens, two text classes, two stop commands, three voice states, and four archive states. Changing supported semantics or widening the claimed domain requires an explicit contract change and a complete rerun. Do not describe these bounds as all songs or all XML.

The source-review tables in `verification/musicxml/README.md` map the profile migration and current pickup/capture additions. The Cartesian grammar does not cover pickup labels, terminal stops, inactive banks, rotation inactivity, `clb`, capture slices, source-bar reuse, sequential continuation, periodic sustain preparation, or `migrateMusicXmlSongV2`. The supplemental witness covers one declared full-measure pickup and terminal stop, not every timeline. Whole-file hashes require review without extending exhaustive claims to those branches.

The original binding grammar fixes a single plain one-bar 4/4 score and registry order. The separate full-setup domain uses the same score, all permutations of six physical identities against four distinct single-row cue targets plus tempo and Panic, their unique three-to-six prefixes, and every list permutation of one representative table per length. It does not cover every arbitrary row-subset combination or every list permutation of every assignment. Neither domain proves raw device maps, producer leases, native scheduling, LED delivery or hardware readiness. See the exact cardinalities and exclusions in `verification/musicxml/README.md`.

## Uncounted annotation and character-reference maintenance

The 32-case supplemental boundary grammar fixes managed Pad 0 and unmanaged Bass rows and crosses two meters, one or two measures, plain or escaped text containing CR, and absent, Lead-in, Tail or both cues. It preserves exact text and source identity through archive-free read/write/read without new measures. Sixteen cases reject misplaced tail offsets, forged source rows, duplicate identities and raw HTML-only entities. A separate named witness preserves Funky, Extra funky and Higher intensity, isolates AF notation, and changes semantic identity when only standard feel words change. These additions do not multiply or reduce the original domains.

The expanded escaped-text case exposed a real product bug at `2ca9cb5`: the previous standard-value parser left `&#13;` as literal text. Source commit `6565fe9` enables numeric decoding and restricts raw entities to XML names and valid XML 1.0 scalar references, excluding comments and CDATA from the lexical guard. Literal entity spellings remain literal. The source-fence baseline failure was verification drift; this escaped-text counterexample was a product defect, fixed separately. See the README for reviewed commits, final counts and receipt.

## Release capture and paired playback

The supplemental eight-case grammar crosses both meters, the two playback orders, and playback that starts within one measure or crosses a barline. Each case checks archive-free preservation of the capture pair, ordered playback, visible directions and compiler output. The thirteenth actual-source mutant drops capture-pair metadata from the writer and must fail `EDGE_METADATA_MEANING`. The original domains and all twelve original witnesses are preserved. The edge witness does not execute playback or capture in C++.
