# Verify terse cue intent

`npm run verify:formal:cues` exhausts 32,390 cases through the actual TypeScript parser. The original 22,110 cases cover every sixteenth-note press and execution in four-count and six-count measures, eight operations, three source names, cell-local anchors, and malformed controls. Another 10,280 cases cover grouped operation pairs, shared presses, independent execution suffixes, authored action order, and equivalent grouped-stop spellings.

Six mutations change the copied production parser. They turn store into autoplay intent, discard source names, shift silent anchors, remove next-measure execution, discard group identity, or lose the inherited group press. Each mutation must fail its named assertion and the restored parser must pass. The group-press mutation fails the group consistency guard before it can produce inconsistent actions.

The compiler tests use an executable fixture with immutable named captures, explicit store and replacement policies, chart-parity word selection, prepared sustain windows, grouped commit and playback, a cross-bank grouped stop, and dry stops. Standalone canonical MusicXML tests preserve these instructions, external sample windows, and explicit per-note order. They also reject forged group metadata, unavailable prepared sources, and independent source effect profiles without explicit source ownership. Per-take profile metadata preserves distinct sources sharing one physical bank, and the canonical decoder rejects profile collisions.

This bounded check establishes parsed intent. It does not establish arbitrary-string parsing, unbounded groups, native scheduling, PCM correctness, physical timing, or device input delivery. Native capture, WASM playback, and the MusicXML semantic domain have separate verification packages. `coverage.json` pins the source reviewed for this run.

External asset declarations do not change the bounded cue grammar. The current source fence also pins `external-assets.ts`, because canonical reading now verifies portable WAV declarations. Asset preparation and cancellation have separate focused tests; native decoding and playback remain outside this parser domain.

## Practice release source review

Updated at source `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4`. Review of the covered diff from `894915f` found changes only in `compiled-song.ts` and `musicxml-song.ts`, from `3abe656` and `08c921d`. The parser, its exhaustive checker, the parser regressions, dependencies and external-asset validator are unchanged. The full 32,390-case domain and all six assertion-specific actual-source mutants pass, including pristine and restored witnesses.

The compiler now admits declared full-measure preludes, unique displayed measure labels, one through four assigned controls, explicit musical loop periods, terminal Tail stops, and periodic sustain-preparation policy. The canonical reader and writer preserve those fields. None changes the parser's cell grammar. The existing domain therefore keeps its original inputs, expectations and exclusions. Pickup timeline, unused-control and canonical integration tests pass separately. Those concrete tests do not make the parser proof exhaustive over source layout, periodic analysis, native packet extensions or DSP.
