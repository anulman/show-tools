# Beat tracker verification

The module builds natively and as WebAssembly. The demo runs through a real Chrome AudioWorklet on localhost.
Generated build and measurement receipts are ignored by Git. The commands below recreate them.

## Automated results

| Check | Result |
| --- | --- |
| Native Release build | Pass with compiler warnings enabled. |
| Clock suite | Pass for arbitrary chunks, delayed and pre-origin taps, epochs, command retries, and Manual ownership. |
| Follower suite | Pass for ideal acquisition, 120-to-180 and reverse transitions, ramps, half/double outliers, skipped observations, phase slewing, and silence. |
| Aubio integration suite | Pass at 44.1 kHz and 48 kHz, including freshness comparisons against new analyzer controls. |
| Twelve native steady PCM cases | Pass, covering 90, 120, and 180 BPM at both rates, seeded and automatic. |
| Actual WASM suite | Pass for ABI, queues, acknowledgments, lifecycle, historical taps, chunk equivalence, PCM, and fixed memory. |
| Browser adapter regression suite | Pass with actual WASM and mocked browser scheduling, including pending microphone permission and resume cancellation. |
| Worklet output suite | Pass with actual WASM for clock crossing alignment, mute/reset tails, coasting, input isolation, and telemetry overflow. |
| JavaScript syntax and Python compilation | Pass. |

Run the commands in [README.md](README.md) to reproduce these checks.
Native fixture traces and `fixtures.json` are under `build/verification/`.
WASM receipts are under `build-wasm/verification/`.

The twelve native fixture cases acquire within eight seconds.
Their median steady tempo errors are below 0.1%, and median phase errors are below 5 ms against the declared fixed pulse grids.
These are generated noise-burst signals. They do not establish accuracy for a microphone, vocals, or arbitrary music.

## Real browser observations

The coordinator drove Chrome through the installed control-ui workflow.
The page loaded the compiled WASM and processed audio at 44.1 kHz.
The built-in silent test signal activated the meter, raw detector indicator, and independent clock animation.
The status changed from Listening to Following.
Applying 90 BPM held Manual while the input and raw detector continued around 120 BPM.
Stopping input left the 90 BPM manual clock running and the level meter at silence.
Selecting Follow and restarting the test input began fresh acquisition without reseeding the clock.

These observations use the actual browser audio graph, rather than a mocked AudioContext.
Physical microphone capture and a person's clap, sung-syllable, and melody trials remain the next musical checks.
Browser suspension and permission-race behavior have automated adapter coverage; they have not all been driven on every browser and device.

## Operator page and click track

Chrome checks confirmed that the default page omits diagnostics and test controls.
Developer mode at `?debug=1` retains the test rhythm. State API metadata retains detector confidence and timing details.
Click track defaults off. Enabling it on an unstarted clock shows a tempo setup hint.
Applying 120 BPM selects Manual and starts browser audio output.
The developer rhythm acquires Following at about 120 BPM. Stopping input leaves the clock and click output running.
The page was left on the normal URL with audio stopped.

The rendered-output tests use the actual worklet and compiled WASM, with mocked message transport.
They check samples against emitted clock crossing frames across different block sizes.
These checks establish generated sample timing. They do not measure speaker latency or fix the reported late microphone claps.

## Review findings and fixes

Astra at xhigh reproduced four implementation defects.
The fixes have dedicated regressions:

- Reset and fresh capture now replace aubio's analyzer. Tone, noise, and silence traces after the boundary match a newly created analyzer's traces.
- A granted microphone stream becomes owned immediately, even while audio resume is pending. Stop, Dispose, and faults release it without waiting for resume.
- Completed duplicate commands replay their original application result and acknowledgment.
- Reset sends terminal cancellation acknowledgments for pending commands.

Reset and fresh capture are immediate lifecycle operations between processing calls.
They can allocate replacement detector state. The processing callback remains allocation-free in module-owned code.
Future lifecycle commands reject explicitly; ordinary BPM, mode, and tap commands can be timestamped inside processing blocks.

## Kernel measurement

Five interleaved Node.js passes measured the optimized WASM engine against a no-op timing-overhead driver.
Each engine pass processed 30 audio seconds of generated pulses followed by 20 seconds of silence, in 128-frame blocks at 48 kHz.
The median pass p99 was 30.33 microseconds, with a pass range of 30.21 to 30.83 microseconds.
The worst observed block took 974.79 microseconds. No measured block exceeded half the 2,666.67-microsecond quantum, and no correctness fault occurred.
The no-op driver's median p99 was 0.125 microseconds. This is instrumentation overhead, not a speedup comparison.

The machine was an Apple M1 Pro with ten available cores, running Node.js 25.6.
Reported load average was 10.23, so the passes were interleaved.
A separate CPU profile confirmed execution in the exported WASM processing function. Stripped symbols prevented a narrower aubio-stage attribution.
Run `node lib/beat-tracker/scripts/measure-wasm.mjs` to repeat the measurement.

These numbers measure the Node.js WASM kernel. They do not prove browser callback deadlines or absence of audio underruns.

## Remaining limits

Aubio can infer a pulse from a constant tone or continuous noise, even with a completely fresh analyzer.
Fresh-control tests distinguish this detector behavior from retained state after Reset.
Exact half/double pulse levels can remain ambiguous without a BPM seed or manual taps.
The meter, detected-beat flash, and mode show the operator what the listener is doing. Tracking diagnostics remain in state metadata.

The repository has no remote configured. No PR or deployment was created.
Local commits were deferred because the configured 1Password SSH signer requires interaction. Source changes remain available for review.
