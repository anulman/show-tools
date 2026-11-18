# Beat tracker

A C++ beat clock with a native WAV runner and browser WASM builds. The [Performance Desk](../../ui/practice/README.md) is the browser interface. The former standalone tracker demo is removed.

## Build the practice clock

Install Node.js and Emscripten, then run this command from the repository root.

```sh
npm run build:wasm
```

The build writes `ui/practice/wasm/manual-clock.wasm` and runs its real-WASM clock tests. That module contains the [complete C++ performance engine](../performance/README.md), including the clock, sequencer, sampler, song transport, and click renderer. This target uses a no-op detector and does not link or download aubio. Microphone capture remains available in the Performance Desk, but it does not infer tempo from microphone input.

The Performance Desk passes this WASM URL explicitly to its browser adapter. Native `pf_start()` selects manual tempo and applies the starting BPM. The combined WASM heap is fixed at 256 MiB. The audio callback does not grow memory. Sample preparation and loading report allocation failure without aborting the module or replacing the prior take.

## Build the optional tempo follower

The full build includes aubio under GPL-3.0-or-later. Install Emscripten, Node.js, and the standard command-line download tools, then run this command from the repository root.

```sh
bash lib/beat-tracker/scripts/build-wasm.sh
```

The build downloads aubio 0.4.9, verifies its SHA-256, and builds a PCM-only static library with Ooura FFT. It writes `lib/beat-tracker/dist/beat-tracker.wasm`, includes the same complete C++ performance engine, and retains the dependency license. Dependencies, caches, and compiled artifacts stay outside Git.

The full follower keeps its last accepted tempo through silence or uncertain detection. Taps, Apply BPM, and Manual take persistent control. Only Follow hands control back to audio. The practice UI does not expose automatic following.

## Build the native module

Install a C++17 compiler, CMake 3.20 or newer, pkg-config, aubio 0.4.9 or newer, and libsndfile.
On macOS with Homebrew, the native dependencies are `cmake`, `pkg-config`, `aubio`, and `libsndfile`.

```sh
cmake -S lib/beat-tracker -B lib/beat-tracker/build -DCMAKE_BUILD_TYPE=Release
cmake --build lib/beat-tracker/build -j 4
ctest --test-dir lib/beat-tracker/build --output-on-failure
lib/beat-tracker/build/beat-tracker recording.wav --bpm 120 > beats.csv
```

Omit `--bpm` for automatic acquisition. Add `--manual` with a seed to compare detector output against a fixed clock.
`--chunk N` changes processing block size for replay checks.
The runner folds file channels to mono. File decoding belongs to the executable; the shared library consumes float PCM. This tracker target does not include a live device host. The [complete native performance target](../performance/README.md#build-and-test-the-native-engine) includes a manual clock without aubio or libsndfile. The sampler also has a [separate native library and tests](../sampler/README.md#build-and-test-the-native-sampler).

CSV event kinds are 1 for clock beats, 2 for raw detections, 3 for accepted observations, 4 for command acknowledgments, and 5 for state snapshots.
Frame timestamps use the file sample rate. Raw detector time and report time are separate columns.
Snapshots include clock BPM, raw BPM, mode, status, level, and phase.

## Use the module

The public C interface is in [include/beat_tracker.h](include/beat_tracker.h).
One caller owns each tracker. Create it at the actual sample rate, process arbitrary PCM blocks, and drain its bounded event queue.
Pass a null input pointer to advance the clock through silence.
Use increasing command sequence numbers and the current snapshot epoch.
All timestamps use engine sample frames; historical tap anchors can precede frame zero.
Reset and fresh-capture commands are immediate lifecycle operations that can allocate detector state between process calls.
The processing callback itself uses preallocated buffers.

The browser adapter is [ui/practice/runtime/beat-tracker.js](../../ui/practice/runtime/beat-tracker.js), with TypeScript declarations beside it. The Performance Desk supplies its manual-only WASM URL explicitly. These source imports assume a module at the repository root that is bundled before serving.

```js
import { BeatTracker } from './ui/practice/runtime/beat-tracker.js';

const tracker = await BeatTracker.create({
	startingBpm: 120,
	wasmUrl: '/ui/practice/wasm/manual-clock.wasm',
	workletUrl: '/ui/practice/practice-worklet.js',
});
await tracker.setManual();
tracker.subscribe((state, events) => render(state, events));
await tracker.startListening();
await tracker.setClickEnabled(true);
await tracker.setManualBpm(100);
await tracker.stopListening();
await tracker.dispose();
```

For automatic tempo following, provide a separately hosted full `beat-tracker.wasm` build and call `follow()`. The generated practice bundle does not copy the GPL-linked full WASM artifact.

Create or resume audio from a user gesture. `tap()` accepts a DOM event timestamp or defaults to the current browser time.
The adapter owns its microphone tracks and any AudioContext it creates. A supplied AudioContext remains the caller's resource.
Clock events report immutable phase crossings. The next beat in a snapshot is a forecast that newer snapshots replace.
`setClickEnabled(boolean)` acknowledges the output setting through `snapshot().clickEnabled`.
The C++ performance engine synthesizes clicks from actual clock crossings, independently of main-thread polling and animation. The browser worklet transfers the rendered blocks.
Click output never enters the detector internally. Speaker audio can still reach a physical microphone.
Reset retains the click preference and cancels the old click tail.

## Repeat verification

Run the native test command above, then build the full WASM target and run these checks.

```sh
node lib/beat-tracker/tests/wasm_tests.mjs
node --import tsx lib/beat-tracker/tests/browser_adapter_tests.mjs
node --import tsx lib/beat-tracker/tests/worklet_audio_tests.mjs
python3 lib/beat-tracker/scripts/generate-fixtures.py lib/beat-tracker/build/fixtures
python3 lib/beat-tracker/scripts/verify-fixtures.py
```

Generated fixtures include impulses with decaying noise, tempo ramps, silence, and a pitched synthetic phrase.
They are deterministic signals, not recordings of a person singing.
The native tests inject ideal observations as well as actual aubio PCM, so clock behavior can be checked independently of detector accuracy.
The adapter tests use actual WASM with mocked browser scheduling. The worklet audio tests render actual WASM clock events into PCM and check alignment, muting, reset, coasting, input isolation, and bounded telemetry.
Real browser and microphone checks remain separate.

`scripts/measure-wasm.mjs` measures the optimized kernel in Node.js. Its results do not measure browser audio underruns.
The build and verification outputs belong in ignored build directories.

## Tracking limits

The supported clock range is 40 to 240 BPM. The initial aubio window and hop are 2,048 and 512 samples.
Four consistent, timing-supported observations establish a candidate. Stale evidence makes the clock coast after four seconds.
Tempo follows with bounded changes. Phase corrections change future frequency rather than jumping backward or replaying beats.
The follower derives accepted tempo from intervals between estimated beat positions to reduce bias in aubio's raw BPM.

On an unseeded start, the stable raw aubio interpretation chooses the pulse level.
Half or double tempo can be musically ambiguous. An established clock supplies a prior, and manual taps select the intended pulse.
A steady tone or weakly accented melody does not guarantee useful detection. The detected-beat flash exposes disagreement with the clock. Tracking details remain available through the state API.
Aubio confidence is a relative value, not a percentage or calibrated probability.

The native package and WASM build can use different FFT backends. Compare clock behavior with identical injected observations separately from detector numeric output.

## Dependency notice

Aubio 0.4.9 is licensed under GPL version 3 or later. The optional full WASM and native tracker link aubio. The practice manual-clock build excludes it.
The build retains its license and pinned source archive. See [LICENSES/aubio.txt](LICENSES/aubio.txt).
