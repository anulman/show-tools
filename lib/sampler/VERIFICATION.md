# Sampler verification

Verified on 2026-10-21.

## Automated behavior

```sh
node --test --test-reporter=spec lib/sampler/tests/*.test.mjs lib/sequencer/tests/*.test.mjs
node lib/beat-tracker/tests/worklet_audio_tests.mjs
node lib/beat-tracker/tests/browser_adapter_tests.mjs
```

The combined suite passed all 77 tests. Both tracker compatibility checks passed.

Coverage includes immediate and quantized recording boundaries, independent slot arms and playback cues, preserving a previous take until replacement, empty takes, the recording limit, microphone/output isolation, and saving a take before playback on the same beat. Actual tracker WASM drives rendered-audio checks across different processing block sizes, tempo changes, cancellation, downbeat changes, and Stop All. Audio scheduling does not depend on UI polling.

Independent Astra xhigh review found no remaining blocking defect after command-ordering and delayed-start fixes were covered by regression tests.

## Browser checks

In Chrome, using the local demo and an actual microphone feed:

- Prepared audio with three empty slots and an active microphone meter.
- Recorded Sample A with immediate start/stop, saved a 5.90-second take, and triggered immediate playback.
- Armed Sample B to start and stop on bar boundaries at 120 BPM; saved an 8.00-second take.
- Cued Sample B on the next bar and observed playback begin.
- Kept the clock in Manual while microphone recording remained available.

## Limits

Physical pedal/arcade hardware, acoustic alignment, and output-device latency have not been measured. Automated onset checks establish audio-frame scheduling, not speaker or microphone latency. Takes are mono, capped at 30 seconds, and retained only in browser memory. Live tracker accuracy with singing and real music remains a separate musical evaluation.
