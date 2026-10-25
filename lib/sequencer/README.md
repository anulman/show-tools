# Native audio sequencer

The C++ [AudioSequenceEngine implementation](src/audio_sequence_engine.cpp) schedules patterns, playback cues, and recording boundaries against authoritative beat IDs and frame timestamps. Its public interface is [include/audio_sequence_engine.h](include/audio_sequence_engine.h).

The [complete performance engine](../performance/README.md) owns sequencer dispatch during normal audio processing. It calls the sampler directly from C++. The browser's [wasm-sequencer.ts](wasm-sequencer.ts) bridge maps names and labels to numeric IDs and reads native state. It does not schedule sounds or call JavaScript playback callbacks. The former JavaScript sequencing implementation is removed.

## Patterns and queued actions

Patterns have an ID, a positive integer `lengthBeats`, and events with zero-based whole-beat positions and sample IDs. Native definition copies and validates the events. Active and queued patterns retain their immutable version when the same ID is redefined. The bridge retains labels by native version so the displayed label matches that retained pattern.

A queue schedules a pattern on the next beat or bar. Recording arms and playback cues share the same bar origin. Mark 1 reanchors bar-quantized pending actions without restarting the active pattern. Epoch changes cancel old queued and active scheduling state. Duplicate beat IDs do not execute actions twice.

Capture stops run before playback cues and pattern events at the same crossing. Starting capture silences that channel. A commit can start its loop at the boundary. Recording channels skip conflicting playback events. Cancellation removes queued work without stopping an active recording.

Generic sequencing accepts a configured meter. The practice song transport supports four beats per bar. [Song scripts](../../songs/README.md) provide copied chart cues, capture hints, and variant playback assignments to the performance engine. UI events observe native state and do not schedule sample frames.

## Ownership and allocation

One caller owns each `sq_engine`. The sampler passed to `sq_create()` is borrowed. Native beat dispatch allocates and frees no memory. Pattern definition and destruction can allocate or collect retired immutable versions. Definition supports up to 64 pattern IDs and 4,096 events per pattern.

The browser uses the sequencer and sampler inside the same WASM module as the clock and performance engine. Current keyboard handling belongs to the practice UI. The earlier browser callback sequencer, clock adapter, keyboard wrapper, and standalone endpoint wrapper remain removed.

## Build and verify

Build the [complete native performance target](../performance/README.md#build-and-test-the-native-engine) for instrument changes. To test the sequencer independently, run these commands from the repository root.

```sh
cmake -S lib/sequencer -B /tmp/show-tools-sequencer -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-sequencer
ctest --test-dir /tmp/show-tools-sequencer --output-on-failure
```

For WASM checks, run `npm run build` and `npm test`. `tests/audio-sequence-engine.test.mjs` exercises the production native bridge. `tests/audio-performance.test.mjs` renders actual clock-driven PCM through the C++ performance engine. Native tests cover quantization, reanchoring, capture ordering, immutable pattern definitions, and epoch behavior.
