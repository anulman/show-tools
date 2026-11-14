---
name: verify-sheet-cues
description: Verify versioned Sheets cue grammar, cell-local anchors, compound operations, named sources, multi-action ingestion, canonical interchange, and capability boundaries when changing sheet-cues.ts or its compiler/reader integration.
---

# Verify Sheets cue intent

Read `docs/implementation/sheet-cues.md`. Run `npm run verify:formal:cues` and `node --import tsx --test lib/performance/tests/sheet-cues.test.ts` from the repository root after `npm ci --ignore-scripts`. Run `npm run typecheck` as well.

The finite-domain command checks the actual `parseSheetCues` implementation, exhaustively covering every sixteenth press and execution count in 4/4 and 6/8, eight operations, three names, immediate/next-bar execution, cell-local silent anchors, and fourteen malformed controls: 22,110 cases. It requires four real source mutants to fail (cx converted to c, source discarded, silent anchor shifted, next-bar offset removed), each preceded and followed by a pristine pass in an isolated temporary copy. A failing assertion is a finding; do not weaken expected intent to get a pass. A missing dependency or compiler is a harness failure.

`verification/cues/coverage.json` records covered hashes and the reviewed source commit. Changed hashes require reviewing the source diff, running `check.ts` and the integration tests, updating the record, then running `verify.ts` including the mutation controls. Advance the source commit only after confirming the checks describe that code. Review `verification/musicxml/coverage.json` separately; its existing 7,488-case domain and two source mutants remain mandatory when changing compiler or MusicXML code.

`sheet-cues.test.ts` checks ingestion, unique multi-action IDs, preservation of unsupported typed intent through archive-free MusicXML, and forged semantic rejection. Those are concrete integration witnesses, not exhaustive XML verification. The grammar command does not prove arbitrary strings, unbounded cells, native scheduling, voice/source resolution, capture extraction, DSP, or physical button tolerance. Native cx/g/h/finite p/named captures remain capability-blocked. No capture model is changed: `verification/capture/CaptureHandoff.tla` still models current c/cr autoplay. Do not weaken that invariant when adding future store-only publication; add an explicit native launch policy, separate store-only properties and real-source native witnesses instead.

Use `/maintain-formal-verification-skill` to review later source drift.
