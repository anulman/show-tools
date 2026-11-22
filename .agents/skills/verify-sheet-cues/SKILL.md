---
name: verify-sheet-cues
description: Verify versioned Sheets cue grammar, cell-local anchors, compound operations, named sources, multi-action ingestion, canonical interchange, and capability boundaries when changing sheet-cues.ts or its compiler/reader integration.
---

# Verify Sheets cue intent

Read `docs/implementation/sheet-cues.md`. Run `npm run verify:formal:cues` and `node --import tsx --test lib/performance/tests/sheet-cues.test.ts` from the repository root after `npm ci --ignore-scripts`. Run `npm run typecheck` as well.

The finite-domain command checks the actual `parseSheetCues` implementation: 33,120 cases. The original 22,110 cover every sixteenth press and execution count in 4/4 and 6/8, eight operations, three names, immediate/next-bar execution, cell-local silent anchors, and fourteen malformed controls. Another 10,280 cover grouped action pairs and grouped-stop spellings. Eight real source mutants must fail: cx converted to c, source discarded, silent anchor shifted, next-bar offset removed, group identity dropped, inherited group press lost, playback order reversed, and release guide made optional. The isolated copy has an initial pristine witness, a source restoration hash check after each mutant, and a final pristine witness with the same domain output as the root baseline. A failing assertion is a finding; do not weaken expected intent to get a pass. A missing dependency or compiler is a harness failure.

`verification/cues/coverage.json` records covered hashes and reviewed source commit `46d87f67751e116aae0f37f7fe47217694688cfa`. Changed hashes require reviewing the source diff, running `check.ts` and the integration tests, updating the record, then running `verify.ts` including the mutation controls. Advance the source commit only after confirming the checks describe that code. Review `verification/musicxml/coverage.json` separately. Its preserved 7,488-case domain, supplemental pickup-label and 6,173-case binding checks, and five actual-source mutants remain mandatory when changing compiler or MusicXML code.

`sheet-cues.test.ts` checks ingestion, unique multi-action IDs, archive-free typed intent, and forged semantic rejection. `pickup-timeline.test.ts` and `inactive-banks.test.ts` separately exercise full pickup measures, explicit loop periods, and unused controls. These are concrete integration witnesses. The parser domain does not prove arbitrary strings, unbounded cells, native scheduling, voice/source resolution, capture extraction, periodic sustain analysis, DSP, or physical button tolerance. Native cx/g/h, finite p and named captures have separate actual native/WASM tests. `verification/capture/CaptureHandoff.tla` distinguishes store-only publication from c/cr autoplay; both properties remain required.

Use `/maintain-formal-verification-skill` to review later source drift.

The binding-metadata maintenance leaves the 32,390-case parser domain and six source mutants unchanged. Optional physical binding metadata has a separate MusicXML grammar; source pins include the new schema and registry without claiming native routing or hardware delivery.

The extra 730 cases cover `ru` and `pp` across both meters and every sixteenth, including grouped store/release arms, both playback orders, and rejection of missing anchors, missing or duplicate names, illegal suffixes and grouped playback pairs. The same source fence pins generated ABI constants consulted by compiler admission. See the verification README for the original bounds and the newer capture and playback witness coverage.
