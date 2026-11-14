# Verify terse cue intent

`npm run verify:formal:cues` exhausts 32,390 cases through the actual TypeScript parser. The original 22,110 cases cover every sixteenth-note press and execution in four-count and six-count measures, eight operations, three source names, cell-local anchors, and malformed controls. Another 10,280 cases cover grouped operation pairs, shared presses, independent execution suffixes, authored action order, and equivalent grouped-stop spellings.

Six mutations change the copied production parser. They turn store into autoplay intent, discard source names, shift silent anchors, remove next-measure execution, discard group identity, or lose the inherited group press. Each mutation must fail its named assertion and the restored parser must pass. The group-press mutation fails the group consistency guard before it can produce inconsistent actions.

The compiler tests use an executable fixture with immutable named captures, explicit store and replacement policies, chart-parity word selection, prepared sustain windows, grouped commit and playback, a cross-bank grouped stop, and dry stops. Standalone canonical MusicXML tests preserve these instructions, external sample windows, and explicit per-note order. They also reject forged group metadata, unavailable prepared sources, and independent source effect profiles without explicit source ownership. Per-take profile metadata preserves distinct sources sharing one physical bank, and the canonical decoder rejects profile collisions.

This bounded check establishes parsed intent. It does not establish arbitrary-string parsing, unbounded groups, native scheduling, PCM correctness, physical timing, or device input delivery. Native capture, WASM playback, and the MusicXML semantic domain have separate verification packages. `coverage.json` pins the source reviewed for this run.

External asset declarations do not change the bounded cue grammar. The current source fence also pins `external-assets.ts`, because canonical reading now verifies portable WAV declarations. Asset preparation and cancellation have separate focused tests; native decoding and playback remain outside this parser domain.
