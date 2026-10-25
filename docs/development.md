# Continue development in separate sessions

Read [how the instrument fits together](architecture.md) before changing its timing or audio routes. Use the [practice contract](../ui/practice/CONTRACT.md) for commands and state, and the [practice guide](../ui/practice/README.md) to perform a take.

## Give each session its own checkout

Create separate worktrees before running agents concurrently. This separates source edits, the Git index, dependencies, and generated `dist/` files.

```sh
git worktree add ../show-tools-filters -b work/filters
git worktree add ../show-tools-ui -b work/ui
git worktree add ../show-tools-elitedesk -b work/elitedesk
```

Run those commands after the handoff documentation commit lands. Start each session in its assigned directory. Commit verified milestones there. Integrate one branch at a time and rerun the affected checks after resolving overlaps.

Assign one owner to a shared contract change before editing it. The likely overlap points are `lib/sampler/include/sample_engine.h`, `lib/sampler/wasm-sampler.ts`, `lib/performance/model.ts`, `ui/practice/audio.ts`, `ui/practice/practice-worklet.ts`, `ui/practice/app.ts`, and `scripts/build-ui.ts`. Separate worktrees prevent accidental overwrites. They do not resolve conflicting designs for these files.

Treat the Sheets helper and its Chrome profile as shared state too. Use one owner for a live chart-follow test so different practice sessions do not compete to select columns.

## Build a browser checkout

Install Node.js, npm, Python 3, and Emscripten with `em++` on `PATH`. From the assigned worktree, run these commands in order.

```sh
npm ci
npm run build
```

The full build compiles the C++ clock and sampler into one manual-tempo WASM module, runs its clock checks, bundles the browser code, and writes static assets into `dist/`. Run `npm test` for sampler and practice integration checks. Serve that directory on a port assigned to this worktree.

```sh
python3 -m http.server 8084 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8084/ui/practice/`. Use a different port for another session. `npm start` is the equivalent static server on port 8082. The optional relay also defaults to 8082, so do not start both there.

For browser-only changes, run `npm run build:ui` after the first full build. Reload the test page after rebuilding. That command needs the generated `ui/practice/wasm/manual-clock.wasm` to exist and replaces `dist/`; it does not rebuild C++.

For mobile checks, serve `dist/` over HTTPS. Microphone access requires a secure context. A phone's `127.0.0.1` refers to the phone, not the development computer. Static hosting is enough for practice audio. Desktop Sheets following is optional and local to its helper computer.

## Start the filter and patch workstream

Read these files before choosing the processing order.

- `lib/sampler/src/sample_engine.cpp` owns capture, sample storage, voice rendering, and channel gain and mute.
- `lib/sampler/include/sample_engine.h` defines its C interface.
- `lib/sampler/wasm-sampler.ts` bridges browser blocks and commands to the C++ engine.
- `ui/practice/runtime/performance-worklet.js` connects that bridge to the worklet and sequencer.
- `ui/practice/audio.ts` owns the separate recording-only live microphone branch.
- `ui/practice/practice-worklet.ts` owns controls, quantized actions, Stop, and Panic.
- `lib/performance/model.ts` owns shared commands and state shapes.

Define which audio a patch processes before connecting controls. Distinguish captured microphone PCM, individual sample channels, the combined sample mix, live voice, and the click. Decide whether effects change the stored take or only playback. A filter on the sample mix will not automatically process the live voice in downloads.

Keep song assignments in `songs/`. Keep browser editors and controls in `ui/`. Put portable low-level processing under `lib/`. Prefer TypeScript for new scripting. Use Effect at asynchronous and external-data boundaries where it helps, outside synchronous rendering and beat dispatch.

Implement sample DSP in the shared C++ engine so WASM practice and the native EliteDesk use the same processing. Preserve the existing capture, trigger, variant, and mixer behavior. Keep preparation and allocation outside native rendering and capture calls.

Verify bypass, parameter changes, stereo behavior, capture routing, and effect tails through Stop, Panic, and reset. Render real PCM in the sampler and sequencer tests. Check a browser take as well. Do not claim realtime safety from a typecheck or an encoding test.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, and the audio code named in the filter section. Design the patch data model and its processing location before wiring UI controls. Keep local practice independent of a relay. Preserve capture, commit-and-autoplay, sample stereo, and the recording-only centered voice route. Identify unresolved sound-routing choices explicitly. Verify the chosen behavior with rendered PCM and a browser take. Commit each verified milestone.

## Start the UI workstream

Begin with `ui/practice/index.html`, `style.css`, and the render and input code in `app.ts`. Use `PracticeAudio` commands and subscriptions for instrument behavior. Keep song-specific names and actions in the chart snapshot and song module.

Preserve Q/W over A/S, Escape-to-Panic, worklet-derived lights, unity sample gains, automatic microphone setup, and automatic demo recording. Keep the mandatory lead-in click independent of the song-click preference. Keep recording preparation and MP3 export states visible and prevent a new take from replacing an export in progress.

Run the practice lifecycle tests and inspect both narrow and desktop layouts in a browser. Exercise focused inputs, repeated Start, Stop during microphone setup, song switching, and download completion. Save any take you need before reloading the page.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, and ui/practice/CONTRACT.md. Iterate on the practice UI under ui/. Keep musical state and chart actions in the audio engine, and keep songs loadable from songs/. Preserve the established keyboard layout, cue lights, capture workflow, and recording lifecycle. Verify the changed interactions in the browser at mobile and desktop widths. Coordinate shared app.ts or audio.ts edits with the other workstreams. Commit each verified milestone.

## Start the EliteDesk workstream

Begin with `lib/beat-tracker/include/beat_tracker.h`, `lib/sampler/include/sample_engine.h`, their C++ implementations, their native CMake targets, and `lib/relay/README.md`. Sampling and capture already run in shared C++. Read `AudioSequenceEngine`, `PracticeEngine`, and `PracticeProcessor` as the behavioral specification for native sequencing and song transport.

Establish a native manual-clock target separately from a live audio host. The current tracker CMake configuration requires aubio and libsndfile. The browser manual-only target excludes aubio. Preserve that licensing distinction when adding native build options.

Choose an audio-device backend and define which thread owns the clock, capture buffers, voices, and commands. One caller owns each C tracker and sampler engine. Their functions are not thread-safe. Keep reset and fresh-audio operations that may allocate outside the processing callback. Audit native buffers, queues, and lifecycle behavior directly.

Use the existing C++ sampler and verify both its WASM and native targets. The browser worklet supplies audio blocks and commands to that engine. Port the remaining sequencing and song-transport behavior in units that can be compared with the browser implementation. Cover capture bounds, commit-and-autoplay, replacement capture, channel gain and mute, explicit stops, and song position. Preserve audio-frame timestamps across any event transport. A relay receipt is not a musical boundary.

Add hardware inputs as domain controls, including debounce and knob mapping. Keep the EliteDesk focused on audio and hardware. Serve browser UIs elsewhere. Implement the hardware producer and browser hardware adapter explicitly; neither is already supplied by starting the relay.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, lib/beat-tracker/README.md, lib/sampler/README.md, and lib/relay/README.md. Use the existing shared C++ clock and sampler. Port the remaining JavaScript sequencing and TypeScript song transport, then connect native audio devices and hardware controls. Establish explicit device and thread ownership. Preserve current browser behavior through conformance checks. Keep UI hosting off the audio machine by default and flag copyleft choices. Commit each verified milestone.

## Verify and report the changed behavior

Run the common checks from the worktree root.

```sh
npm run typecheck
npm test
npm run check:layout
```

Run `npm run build` when C++ or generated assets change. Run `npm run build:ui` for browser changes after WASM exists. Tests use local sockets for relay and helper fixtures, so a sandbox that prohibits listening can cause permission failures.

Use [native sampler build and test instructions](../lib/sampler/README.md#build-and-test-the-native-sampler) and [native tracker instructions](../lib/beat-tracker/README.md#build-the-native-module) for native changes. The root test command does not prove either native CMake build. Optional GPL follower checks use `npm run test:follower` after building the full follower artifact as described in the tracker guide.

For audio changes, inspect rendered PCM and exercise the browser path that users run. For Sheets changes, observe intermediate frames as well as final selection. The earlier viewport test missed visible jumps because it checked only the final state.

Record which checks ran and what remains unverified. After the C++ sampler migration, the default suite passed 159 tests with two optional follower tests skipped. The follower-enabled suite passed all 161 tests. Both WASM builds, the browser build, typecheck, and layout checks passed. The standalone native sampler passed CMake tests and AddressSanitizer, undefined-behavior, and float-cast-overflow checks.

A Chrome test used synthetic microphone input with the production audio adapter and worklet. C++ captured two bars at 44,100 Hz into 88,200 frames, autoplay started on bar 3, MP3 export decoded into two audible channels, and Stop left zero active voices. The WASM tests also cover DYC's three-press cowbell capture and automatic variant playback. This does not establish physical microphone quality, phone behavior, or hardware latency.

Earlier desktop checks covered centered live voice, MP3 conversion from native WebM and MP4 recordings, and the CDP helper's selection transitions. Physical-phone behavior, the complete installed extension path, and EliteDesk device behavior remain unverified.

## Keep the handoff current

Update the practice contract when command or state behavior changes. Update the architecture explanation when ownership or audio routing changes. Keep the module README files current for their commands. Historical `PLAN.md` and `VERIFICATION.md` files describe earlier POCs and do not override current code or tests.

Keep compiled output, recordings, and test artifacts out of commits. `lib/sampler/wasm-abi.ts` is checked-in generated source. Regenerate it alongside C header changes. A verified source change and its relevant documentation belong in the same milestone.
