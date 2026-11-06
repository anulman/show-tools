# Tuner in the shared audio session

The tuner borrows the practice desk's microphone, audio device, and native performance engine. It has no standalone microphone, AudioContext, WASM loader, or JavaScript pitch detector. The same C++ utility runs inside browser WASM and the native host.

`lib/tuner/` owns monophonic pitch detection, note spelling, scale planning, manual progression, and reference synthesis. `pf_process_stems()` supplies raw microphone input before voice effects and capture. Reference tones enter the sample/click output bus and never enter the digital microphone capture path. Acoustic speaker leakage remains possible.

The initial exercise is one ascending octave including the upper tonic. Major is the default. Natural minor and chromatic have explicit native interval tables. Selections apply immediately. Confirming advances one note without starting or changing reference playback. Whole-scale preview has its own native cursor and never confirms the exercise. Detection never confirms a note. C3 uses MIDI 48, with MIDI 60 as C4.

A reference note lasts 1.5 seconds with a native envelope. Whole-scale playback uses the same notes with 150-millisecond gaps and finishes automatically. Stop sound cancels playback without switching off listening. Analysis pauses during playback and for 150 milliseconds afterward. These are initial software defaults rather than measured hardware calibration. Pitch analysis covers 50 to 1500 Hz and reports uncertainty instead of inferring polyphonic notes or notation.

PF owns the utility independently of song transport. Separate tuner readback leaves historical song-event snapshots unchanged. Every tuner mutation checks its observed control revision. Pitch telemetry does not change that revision. Start, Stop, Panic, and microphone loss close tuning and invalidate earlier controls. Activating the tuner requires stopped transport. The browser also prevents tuning during demo output recording because that recording includes the reference bus.

A mounted view borrows an injected session capability. Opening the view is inert. Closing it stops tuning without terminating the shared audio session. Hardware mode uses the existing native owner and its PCM handles while the song remains Prepared. Utility activity is an additional reason to process audio, not a song Start.

## Verify the native utility

```sh
cmake -S lib/performance -B /tmp/show-tools-tuner-native -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/show-tools-tuner-native -j4
ctest --test-dir /tmp/show-tools-tuner-native --output-on-failure
bash lib/beat-tracker/scripts/build-manual-wasm.sh
```

Native fixtures check scales and spelling, repeated confirmations, finite tone PCM, pitch at 44.1 and 48 kHz, harmonics, silence, noise, input loss, block partitions, and allocation-free processing. The PF integration test checks stopped reference playback on the existing stems, sung pitch readback, and Start/Stop/Panic fencing. Synthetic fixtures establish algorithm and lifecycle behavior, not accuracy on an installed microphone.
