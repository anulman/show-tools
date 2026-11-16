---
name: verify-sheet-cues
description: Verify versioned Sheets cue grammar, cell-local anchors, compound operations, named sources, multi-action ingestion, canonical interchange, and capability boundaries when changing sheet-cues.ts or its compiler/reader integration.
---

# Verify Sheets cue intent

Read `docs/implementation/sheet-cues.md`. Run `npm run verify:formal:cues` and `node --import tsx --test lib/performance/tests/sheet-cues.test.ts` from the repository root after `npm ci --ignore-scripts`. Run `npm run typecheck` as well.

The finite-domain command checks the actual `parseSheetCues` implementation: 32,390 cases. The original 22,110 cover every sixteenth press and execution count in 4/4 and 6/8, eight operations, three names, immediate/next-bar execution, cell-local silent anchors, and fourteen malformed controls. Another 10,280 cover grouped action pairs and grouped-stop spellings. Six real source mutants must fail: cx converted to c, source discarded, silent anchor shifted, next-bar offset removed, group identity dropped, and inherited group press lost. Each mutant has pristine and restored witnesses. A failing assertion is a finding; do not weaken expected intent to get a pass. A missing dependency or compiler is a harness failure.

`verification/cues/coverage.json` records covered hashes and reviewed source commit `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`. Changed hashes require reviewing the source diff, running `check.ts` and the integration tests, updating the record, then running `verify.ts` including the mutation controls. Advance the source commit only after confirming the checks describe that code. Review `verification/musicxml/coverage.json` separately. Its preserved 7,488-case domain, supplemental pickup-label and 6,173-case binding checks, and five actual-source mutants remain mandatory when changing compiler or MusicXML code.

`sheet-cues.test.ts` checks ingestion, unique multi-action IDs, archive-free typed intent, and forged semantic rejection. `pickup-timeline.test.ts` and `inactive-banks.test.ts` separately exercise full pickup measures, explicit loop periods, and unused controls. These are concrete integration witnesses. The parser domain does not prove arbitrary strings, unbounded cells, native scheduling, voice/source resolution, capture extraction, periodic sustain analysis, DSP, or physical button tolerance. Native cx/g/h, finite p and named captures have separate actual native/WASM tests. `verification/capture/CaptureHandoff.tla` distinguishes store-only publication from c/cr autoplay; both properties remain required.

Use `/maintain-formal-verification-skill` to review later source drift.

The binding-metadata maintenance leaves the 32,390-case parser domain and six source mutants unchanged. Optional physical binding metadata has a separate MusicXML grammar; source pins include the new schema and registry without claiming native routing or hardware delivery.
