# Tuner in the shared audio session

The tuner borrows the practice desk's microphone, audio device, and native performance engine. It has no standalone microphone, AudioContext, WASM loader, or JavaScript pitch detector. The same C++ utility runs inside browser WASM and the native host.

`lib/tuner/` owns monophonic pitch detection, note spelling, scale planning, manual progression, and reference synthesis. `pf_process_stems()` supplies raw microphone input before voice effects and capture. Reference tones enter the sample/click output bus and never enter the digital microphone capture path. Acoustic speaker leakage remains possible.

The initial exercise is one ascending octave including the upper tonic. Major is the default. Natural minor and chromatic have explicit native interval tables. Selections apply immediately. Confirming advances one note without starting or changing reference playback. Whole-scale preview has its own native cursor and never confirms the exercise. Detection never confirms a note. C3 uses MIDI 48, with MIDI 60 as C4.

A reference note lasts 1.5 seconds with a native envelope. Whole-scale playback uses the same notes with 150-millisecond gaps and finishes automatically. Stop sound cancels playback without switching off listening. Analysis pauses during playback and for 150 milliseconds afterward. These are initial software defaults rather than measured hardware calibration. Pitch analysis covers 50 to 1500 Hz and reports uncertainty instead of inferring polyphonic notes or notation.

PF owns the utility independently of song transport. Separate tuner readback leaves historical song-event snapshots unchanged. Every tuner mutation checks its observed control revision. Pitch telemetry does not change that revision. Start, Stop, Panic, and microphone loss close tuning and invalidate earlier controls. Activating the tuner requires stopped transport. The browser also prevents tuning during demo output recording because that recording includes the reference bus.

A mounted view borrows an injected session capability. Opening the view is inert. Closing it stops tuning without terminating the shared audio session. Hardware mode uses the existing native owner and its PCM handles while the song remains Prepared. Utility activity is an additional reason to process audio, not a song Start.

## Scale dial

`ui/tuner/scene.ts` paints the pixel dial from an explicit native `TunerState`, presentation time, aspect, and approved ball image. It owns no microphone, session, timer, or subscription. Its notches use the exact ordered native targets, including the separate upper tonic. Only an in-scale pitched observation lights a live notch and its dimmer lower trail. Unvoiced, reference, off, out-of-scale, and out-of-range observations clear the live hit without advancing confirmed progress.

`ui/tuner/dial.ts` connects that painter to the panel. It loads the promoted image, observes available space, and coalesces state/resize updates into one animation frame. Idle views have no perpetual animation loop. Disposal cancels a pending frame, disconnects resize observation, releases the image, and fences late completion. Both aspect canvases use native dimensions with integer CSS scaling and nearest sampling. The sung-note and cents text remain accessible independently of the decorative canvas.

The Figma-approved image and source receipt live in `assets/video/tuner/`. The UI builder validates the hash, native dimensions, nonempty pixels, and transparent corners, then includes the exact image and receipt in the practice offline cache. The deterministic renderer review fixture is separate from the product and opens no audio session.

Run the focused renderer and browser-adapter checks with:

```sh
node --import tsx --test ui/tuner/tests/*.test.ts ui/practice/tests/tuner-dial.test.ts ui/practice/tests/remote-session.test.ts
```

The shared-audio browser fixture also checks native C3 reaching the first dial notch, immediate chromatic target changes, and unchanged manual confirmation. Add `review` to its query string to pause on synthetic C3 for visual review, then use **Continue shared tuner checks** to finish and dispose its audio. This is synthetic input through the existing engine, not installed microphone acceptance.

## Verify the native utility

```sh
cmake -S lib/performance -B /tmp/show-tools-tuner-native -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/show-tools-tuner-native -j4
ctest --test-dir /tmp/show-tools-tuner-native --output-on-failure
bash lib/beat-tracker/scripts/build-manual-wasm.sh
```

Native fixtures check scales and spelling, repeated confirmations, finite tone PCM, pitch at 44.1 and 48 kHz, harmonics, silence, noise, input loss, block partitions, and allocation-free processing. The PF integration test checks stopped reference playback on the existing stems, sung pitch readback, and Start/Stop/Panic fencing. Synthetic fixtures establish algorithm and lifecycle behavior, not accuracy on an installed microphone.
