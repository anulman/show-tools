---
name: verify-musicxml-semantics
description: Verify canonical MusicXML semantic preservation over a complete finite input grammar. Use when changing the MusicXML reader, writer, compiler, semantic digest, sheet ingestion, normalized annotations, or saved song voice metadata.
---

# Verify canonical MusicXML semantics

Run `node --import tsx verification/musicxml/verify.ts` from the repository root. Install the locked dependencies with `npm ci --ignore-scripts` if needed. Run `node_modules/.bin/tsc --project verification/musicxml/tsconfig.json --noEmit` for the verification sources.

Read `verification/musicxml/README.md` before interpreting a result. The finite domain has 624 score inputs and 7,488 canonical cases. It uses the actual TypeScript implementation, not a handwritten parser model. A pass is bounded exhaustive verification, not a proof for arbitrary XML or the audio engine.

## Covered source and sync record

`verification/musicxml/coverage.json` records exact file hashes and source sync commit `99c840928bf4beaccfe79905545823efad83fcd2`. It covers:

- `lib/performance/musicxml-song.ts`: `semanticDigest`, `writeMusicXmlSong`, `readMusicXmlSong`, and `compileMusicXmlSong`.
- `lib/performance/sheet-musicxml.ts`: `importSheetMusicXml`.
- `lib/performance/compiled-song.ts`: source compilation, arrangement parsing, executable program validation, and schemas used by the reader.
- `lib/performance/song-source.ts`, `columns.ts`, `score-xml.ts`, `sheet-musical-annotations.ts`, and `sheet-stage-notation.ts`: source and normalized score construction.
- `lib/voice-catalog/sheet-voices.ts` and `model.ts`: score-part discovery and saved voice metadata validation.
- `package-lock.json`: exact external dependencies.

## Interpret failures

The runner verifies source hashes, runs the full Cartesian domain, and then requires two actual-source mutants in a temporary copy to fail their named properties. Both restored witnesses must pass afterward. It never changes production files or connects to live services.

`BOUND_CASE_FAILURE` names an input whose current implementation violates the stated contract. Read its cause and replay that score input from `domain.ts`. Preserve the evidence and report the finding. Do not change product code or weaken the rule unless the task authorizes the corresponding behavior change.

`SOURCE_DRIFT` means covered code changed since the sync record. It is not proof of a product bug. Review the covered diff against the recorded commit, then run `node --import tsx verification/musicxml/check.ts` to check the current implementation without the old hash gate. Compare the new behavior with the plain-language properties. Reviewers must distinguish an intended meaning change from a parser or model error.

If the new behavior is intended, update the grammar, expectations, mutation witnesses, and proposed coverage hashes together. Compute hashes from the actual files. Run the complete `verify.ts` command against that proposed record. Advance the sync commit in both this skill and `coverage.json` only after the full domain and both real-source mutation challenges pass and the verification still describes the code at that commit. Commit the verified record with the corresponding change. `/maintain-formal-verification-skill` provides the broader drift-review workflow.

`MUTANT_SOURCE_SHAPE_DRIFT`, `MUTANT_SURVIVED`, or `WRONG_MUTANT_FAILURE` means the implementation-coupling evidence is incomplete. Inspect the real source and repair the witness. Do not count an unrelated exception or the mere presence of an assertion string as a pass.

## Intent and bounds

Preserve round-trip program/report/voice meaning, archive independence, displayed-action agreement, and semantic identity changes. The 6/8 cases count six eighth-note chart and BPM beats; the grammar makes no phase assumption about pedal onset.

The current domain fixes four pad parts and varies one reference row plus optional live vocals, one to three bars, two meters, three per-bar tokens, two text classes, two stop commands, three voice states, and four archive states. Changing supported semantics or widening the claimed domain requires an explicit contract change and a complete rerun. Do not describe these bounds as all songs or all XML.
