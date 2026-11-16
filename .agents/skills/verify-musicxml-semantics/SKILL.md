---
name: verify-musicxml-semantics
description: Verify canonical MusicXML semantic preservation over a complete finite input grammar. Use when changing the MusicXML reader, writer, compiler, semantic digest, sheet ingestion, normalized annotations, or saved song voice metadata.
---

# Verify canonical MusicXML semantics

Run `node --import tsx verification/musicxml/verify.ts` from the repository root. Install the locked dependencies with `npm ci --ignore-scripts` if needed. Run `node_modules/.bin/tsc --project verification/musicxml/tsconfig.json --noEmit` for the verification sources.

Read `verification/musicxml/README.md` before interpreting a result. The finite domain has 624 score inputs and 7,488 canonical cases. Separate supplemental checks cover a declared pickup/Tail timeline and 6,173 zero-to-two-binding configurations, including 1,814 accepted and 4,359 rejected duplicate/overlap assignments. It uses the actual TypeScript implementation, not a handwritten parser model. A pass is bounded exhaustive verification plus that concrete witness, not a proof for arbitrary XML or the audio engine.

## Covered source and sync record

`verification/musicxml/coverage.json` records exact file hashes and source sync commit `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`. The original finite domain and three existing source mutants remain unchanged. Two additional real-source mutants drop binding preservation and omit bindings from semantic identity; the supplemental binding grammar must catch them. The separate cue verifier covers the terse grammar. Runtime tuner selection, pitch observations and periodic source analysis remain outside this verifier. It covers:

- `lib/performance/musicxml-song.ts`: `semanticDigest`, `writeMusicXmlSong`, `readMusicXmlSong`, and `compileMusicXmlSong`.
- `lib/performance/sheet-musicxml.ts`: `importSheetMusicXml`.
- `lib/performance/compiled-song.ts`: source compilation, arrangement parsing, executable program validation, and schemas used by the reader.
- `lib/performance/sheet-cues.ts`: the versioned cue parser; its separate finite domain is covered by `verify-sheet-cues`.
- `lib/performance/song-source.ts`, `columns.ts`, `score-xml.ts`, `sheet-musical-annotations.ts`, and `sheet-stage-notation.ts`: source and normalized score construction.
- `lib/voice-catalog/sheet-voices.ts` and `model.ts`: score-part discovery and saved voice metadata validation.
- `input-bindings.ts` and `model.ts`: validated canonical binding metadata and its pure physical/row registries.
- `package-lock.json`: exact external dependencies.

## Interpret failures

The runner verifies source hashes, runs the full Cartesian domain and supplemental timeline witness, and requires five actual-source mutants in a temporary copy to fail their named properties. Each restored witness must pass afterward. Mutant acceptance requires the exact structured property-failure result emitted by a named assertion, exit code 1, and empty stderr. It never changes production files or connects to live services.

`BOUND_CASE_FAILURE` names an input whose current implementation violates the stated contract. Read its cause and replay that score input from `domain.ts`. Preserve the evidence and report the finding. Do not change product code or weaken the rule unless the task authorizes the corresponding behavior change.

`SOURCE_DRIFT` means covered code changed since the sync record. It is not proof of a product bug. Review the covered diff against the recorded commit, then run `node --import tsx verification/musicxml/check.ts` to check the current implementation without the old hash gate. Compare the new behavior with the plain-language properties. Reviewers must distinguish an intended meaning change from a parser or model error.

If the new behavior is intended, update the grammar, expectations, mutation witnesses, and proposed coverage hashes together. Compute hashes from the actual files. Run the complete `verify.ts` command against that proposed record. Advance the sync commit in both this skill and `coverage.json` only after the full domain and all five real-source mutation challenges pass and the verification still describes the code at that commit. Commit the verified record with the corresponding change. `/maintain-formal-verification-skill` provides the broader drift-review workflow.

`MUTANT_SOURCE_SHAPE_DRIFT`, `MUTANT_SURVIVED`, or `WRONG_MUTANT_FAILURE` means the implementation-coupling evidence is incomplete. Inspect the real source and repair the witness. Do not count an unrelated exception or the mere presence of an assertion string as a pass.

## Intent and bounds

Preserve round-trip program/report/voice meaning, archive independence, displayed-action agreement, and semantic identity changes. The 6/8 cases count six eighth-note chart and BPM beats; the grammar makes no phase assumption about pedal onset.

The current domain fixes four pad parts and varies one reference row plus optional live vocals, one to three bars, two meters, three per-bar tokens, two text classes, two stop commands, three voice states, and four archive states. Changing supported semantics or widening the claimed domain requires an explicit contract change and a complete rerun. Do not describe these bounds as all songs or all XML.

The source-review tables in `verification/musicxml/README.md` map the profile migration and current pickup/capture additions. The Cartesian grammar does not cover pickup labels, terminal stops, inactive banks, rotation inactivity, `clb`, capture slices, source-bar reuse, sequential continuation, periodic sustain preparation, or `migrateMusicXmlSongV2`. The supplemental witness covers one declared full-measure pickup and terminal stop, not every timeline. Whole-file hashes require review without extending exhaustive claims to those branches.

The binding grammar fixes a single plain one-bar 4/4 score and registry order. It does not prove three-to-six-binding combinations, ordering permutations, raw device maps, producer leases, native scheduling or hardware readiness. See the current source-review and result section in `verification/musicxml/README.md`.
