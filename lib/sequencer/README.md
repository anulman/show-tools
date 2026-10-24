# Audio sequencer

`AudioSequenceEngine` runs inside the shared audio worklet. It schedules patterns, playback cues, and recording boundaries against authoritative beat IDs and frame timestamps.

Patterns have an ID, a positive integer `lengthBeats`, and events with zero-based whole-beat `atBeat` positions and sample IDs. The engine copies and validates each pattern. `queue` schedules a pattern on the next beat or bar. `armRecording` and `cue` use the same bar origin.

The [practice worklet](../../ui/practice/practice-worklet.ts) owns song transport and chart-driven manual actions. [Song scripts](../../songs/README.md) provide chart cues and sparse-capture hints. UI events observe audio state and do not schedule sample frames.

The earlier browser callback sequencer, clock adapter, keyboard wrapper, and standalone endpoint wrapper have been removed. Current keyboard handling belongs to the practice UI.

Run `npm test` from the repository root after `npm run build`. `tests/audio-sequence-engine.test.mjs` checks scheduling behavior; `tests/audio-performance.test.mjs` renders actual WASM-driven PCM.
