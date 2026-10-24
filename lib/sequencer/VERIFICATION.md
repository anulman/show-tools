# Sequencer verification

Historical POC record. Current behavior and supported APIs are documented in [README.md](README.md).

## Automated checks

Run from the repository root.

```sh
node --test lib/sequencer/tests/*.test.mjs
node lib/beat-tracker/tests/browser_adapter_tests.mjs
node lib/beat-tracker/tests/worklet_audio_tests.mjs
```

All 30 sequencer tests pass. They exercise public action delivery and snapshots with deterministic clock observations, the real BeatTracker adapter receiving fixture messages, and keyboard event targets. They cover section-dependent resolution, simultaneous order, delayed crossings, duplicate and backward observations, automatic off/on, pause/resume, source gaps, reset, callback errors, disposal, and synchronous abort-listener reentrancy.

The existing tracker adapter and rendered WASM click-audio suites also pass. JavaScript syntax checks and git diff whitespace checks pass. No native tracker code changed.

## Real browser checks

Chrome loaded the demo through localhost:8081 and used the existing compiled WASM AudioWorklet clock.

- Play advanced musical position through Verse, Chorus, and Bridge and fired programmed visual actions.
- Pause froze song position while leaving manual actions available.
- The A key fired Blue wash in Bridge. After Reset, the same key fired Sage wash in Verse.
- Disabling programmed cues before Play allowed section changes without firing those cues. Re-enabling after the scheduled moments did not replay them.
- A mouse click on Hit fired the Bridge's Pink accent at the displayed song position.
- Setting 240 BPM advanced the sequence at the changed tempo.
- An invalid initial tempo produced a readable validation message before audio initialization.
- The normal page omitted diagnostics. The debug URL exposed the metadata disclosure.

The browser was left on the normal URL at 120 BPM, ready to Play.

## Limits

Callbacks arrive on the browser main thread after authoritative beat telemetry. The checks do not establish sample-accurate output timing. Manual actions use the latest committed whole beat. Play establishes the song origin; microphone tracking does not infer song sections or the music's true downbeat.

The demo callbacks produce visual lighting previews. Physical arcade hardware, real show outputs, and microphone-follow behavior in the sequencer page were not physically tested. The keyboard path is shared with a keyboard-emulating arcade controller.

Source changes remain uncommitted. The existing repository has no remote, and its configured signing flow requires operator interaction.
