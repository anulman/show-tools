# Continue development in separate sessions

Read [how the instrument fits together](architecture.md) before changing its timing or audio routes. Use the [practice contract](../ui/practice/CONTRACT.md) for commands and state, and the [practice guide](../ui/practice/README.md) to perform a take.

The [four-workstream planning brief](workstreams.md) records the current priorities: slapback patches, the Performance Engine and deterministic chart compiler, peripheral management, and the Video Assistant. It supersedes the initial UI-only and audio-hosting-first assignments below.

## Give each session its own checkout

Create separate worktrees before running agents concurrently. This separates source edits, the Git index, dependencies, and generated `dist/` files.

```sh
git worktree add ../show-tools-filters -b work/filters
git worktree add ../show-tools-ui -b work/ui
git worktree add ../show-tools-elitedesk -b work/elitedesk
```

Run those commands after the handoff documentation commit lands. Start each session in its assigned directory. Commit verified milestones there. Integrate one branch at a time and rerun the affected checks after resolving overlaps.

Assign one owner to a shared contract change before editing it. The likely overlap points are `lib/performance/include/performance_engine.h`, `lib/performance/wasm-performance.ts`, `lib/sequencer/include/audio_sequence_engine.h`, `lib/sampler/include/sample_engine.h`, `lib/performance/model.ts`, `ui/practice/audio.ts`, `ui/practice/practice-worklet.ts`, `ui/practice/app.ts`, and `scripts/build-ui.ts`. Separate worktrees prevent accidental overwrites. They do not resolve conflicting designs for these files.

Treat the Sheets helper and its Chrome profile as shared state too. Use one owner for a live chart-follow test so different practice sessions do not compete to select columns.

## Build a browser checkout

Install Node.js, npm, Python 3, and Emscripten with `em++` on `PATH`. From the assigned worktree, run these commands in order.

```sh
npm ci
npm run build
```

The full build compiles the C++ performance engine, clock, sequencer, and sampler into one manual-tempo WASM module. It runs clock checks, bundles the browser code, and writes static assets into `dist/`. Run `npm test` for engine and practice integration checks. Serve that directory on a port assigned to this worktree.

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
- `lib/performance/src/performance_engine.cpp` owns block processing, transport, chart actions, and click rendering.
- `lib/performance/include/performance_engine.h` defines the complete engine interface.
- `lib/performance/wasm-performance.ts` bridges browser blocks and declarative song data to C++.
- `ui/practice/audio.ts` owns the separate recording-only live microphone branch.
- `ui/practice/practice-worklet.ts` routes controls and publishes native events.
- `lib/performance/model.ts` owns shared commands and state shapes.

Define which audio a patch processes before connecting controls. Distinguish captured microphone PCM, individual sample channels, the combined sample mix, live voice, and the click. Decide whether effects change the stored take or only playback. A filter on the sample mix will not automatically process the live voice in downloads.

Keep song assignments in `songs/`. Keep browser editors and controls in `ui/`. Put portable low-level processing under `lib/`. Prefer TypeScript for new scripting. Use Effect at asynchronous and external-data boundaries where it helps, outside synchronous rendering and beat dispatch.

Implement sample DSP in the shared C++ engine so WASM practice and the native EliteDesk use the same processing. Preserve the existing capture, trigger, variant, and mixer behavior. Keep preparation and allocation outside native rendering and capture calls.

Verify bypass, parameter changes, stereo behavior, capture routing, and effect tails through Stop, Panic, and reset. Render real PCM in the sampler and sequencer tests. Check a browser take as well. Do not claim realtime safety from a typecheck or an encoding test.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, and the audio code named in the filter section. Design the patch data model and its processing location before wiring UI controls. Keep local practice independent of a relay. Preserve capture, commit-and-autoplay, sample stereo, and the recording-only centered voice route. Identify unresolved sound-routing choices explicitly. Verify the chosen behavior with rendered PCM and a browser take. Commit each verified milestone.

## Start the UI workstream

Begin with `ui/practice/index.html`, `style.css`, and the render and input code in `app.ts`. Use `PracticeAudio` commands and subscriptions for instrument behavior. Keep song-specific names and actions in the chart snapshot and song module.

Preserve Q/W over A/S, Escape-to-Panic, native light states, unity sample gains, automatic microphone setup, and automatic demo recording. Keep the mandatory lead-in click independent of the song-click preference. Keep recording preparation and MP3 export states visible and prevent a new take from replacing an export in progress.

Run the practice lifecycle tests and inspect both narrow and desktop layouts in a browser. Exercise focused inputs, repeated Start, Stop during microphone setup, song switching, and download completion. Save any take you need before reloading the page.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, and ui/practice/CONTRACT.md. Iterate on the practice UI under ui/. Keep musical state and chart actions in the audio engine, and keep songs loadable from songs/. Preserve the established keyboard layout, cue lights, capture workflow, and recording lifecycle. Verify the changed interactions in the browser at mobile and desktop widths. Coordinate shared app.ts or audio.ts edits with the other workstreams. Commit each verified milestone.

## Start the EliteDesk workstream

Read the [confirmed hardware inventory](hardware-inventory.md) and the operator's PR #3 review before revising this plan. Unknown installation facts block their dependent design decisions; ask the operator rather than selecting a controller, role, cadence, or API by assumption. The inventory and current workstream brief supersede speculative examples below.

Begin with [the native performance guide](../lib/performance/README.md), `lib/performance/include/performance_engine.h`, and `lib/relay/README.md`. Build and test the complete native engine before adding device code. Its manual-tempo CMake target already links the clock, sequencer, and sampler without aubio or libsndfile.

Choose an audio-device backend and give one thread ownership of the performance engine. Clear each output block, pass microphone PCM to `pf_process()`, and route the rendered channels to the device. Do not also call `bt_process()` or dispatch `sq_on_beat()` on the borrowed component handles. The performance engine owns those calls.

Implement a loader for the compiled song instruction data. Browser song modules produce declarative events, chart cues, capture hints, and variant playback assignments. The native host must load the same instructions and pass them to `pf_configure()` while stopped. No JavaScript runtime is required to execute a configured song. The repository does not yet provide the device service or its song-file loader.

Drain native events on the engine's owning thread into a bounded host queue. Add run IDs and chart metadata and publish copied records outside the device callback. Do not query the engine concurrently from an observer thread. Preserve source audio-frame timestamps. A relay receipt is not a musical boundary.

Keep reset and fresh-audio operations that may allocate outside the processing callback. Audit native device buffers, command queues, and lifecycle behavior directly. Preserve capture bounds, commit-and-autoplay, replacement capture, channel gain and mute, explicit stops, and song position when adding the host.

Add hardware inputs as domain controls, including debounce and knob mapping. Keep the EliteDesk focused on audio and hardware. Serve browser UIs elsewhere. Implement the hardware producer and browser hardware adapter explicitly; neither is already supplied by starting the relay.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, lib/performance/README.md, and lib/relay/README.md. Use the existing complete C++ performance engine. Connect native audio devices, load compiled song instructions, and add hardware controls. Give one thread ownership of the engine and let pf_process execute musical timing and rendering. Preserve browser behavior through conformance checks. Keep UI hosting off the audio machine by default and flag copyleft choices. Commit each verified milestone.

## Verify and report the changed behavior

Run the common checks from the worktree root.

```sh
npm run typecheck
npm test
npm run check:layout
```

Run `npm run build` when C++ or generated assets change. Run `npm run build:ui` for browser changes after WASM exists. Tests use local sockets for relay and helper fixtures, so a sandbox that prohibits listening can cause permission failures.

Use [native performance build and test instructions](../lib/performance/README.md#build-and-test-the-native-engine) for complete engine changes. The root test command does not prove the native CMake build. The [sampler target](../lib/sampler/README.md#build-and-test-the-native-sampler) and [tracker target](../lib/beat-tracker/README.md#build-the-native-module) remain available for narrower changes. Optional GPL follower checks use `npm run test:follower` after building the full follower artifact as described in the tracker guide.

For audio changes, inspect rendered PCM and exercise the browser path that users run. For Sheets changes, observe intermediate frames as well as final selection. The earlier viewport test missed visible jumps because it checked only the final state.

Record which checks ran and what remains unverified. After the complete performance migration, the default suite passed 169 tests with two optional follower skips. The follower-enabled suite passed all 171 tests. Both WASM builds, typecheck, browser build, and layout checks passed. The native CMake target passed all three component tests. AddressSanitizer, undefined-behavior, and float-cast-overflow checks also passed. Separate worklet tests verified click PCM frame by frame, reset and mute tails, analyzer isolation, and bounded telemetry.

Chrome verified the production adapter with synthetic microphone input. Four native lead-in clicks remained audible with song click off. Capture retained exactly two bars as 88,200 frames at 44,100 Hz, autoplay began on bar 3, MP3 export decoded into two audible channels, and Stop left zero active voices. Physical microphone quality, phone behavior, the complete installed extension path, and EliteDesk device behavior remain separate verification tasks.

## Keep the handoff current

Update the practice contract when command or state behavior changes. Update the architecture explanation when ownership or audio routing changes. Keep the module README files current for their commands. Historical `PLAN.md` and `VERIFICATION.md` files describe earlier POCs and do not override current code or tests.

Keep compiled output, recordings, and test artifacts out of commits. The `wasm-abi.ts` files under `lib/sampler/`, `lib/sequencer/`, and `lib/performance/` are checked-in generated source. Regenerate them alongside their C header changes. Increase the performance ABI version when changing its binary contract. A verified source change and its relevant documentation belong in the same milestone.

## Prepare the arrived I-PAC harness

Use the [confirmed inventory](hardware-inventory.md) and [peripheral wiring guide](../lib/peripherals/README.md) for the complete harness. `npm run test:peripherals` builds native diagnostics, processes synthetic PCM through the current C++ engine, and compares portable native/WASM results without opening devices. `npm run peripherals:summary -- /path/to/probe.ndjson` summarizes an operator recording without assigning musical meanings.

The native `peripheral-probe` provides explicit `list`, `listen`, and guarded `led` commands for Mac and Linux. Build/help/tests perform no hardware IO. Actual key maps, spinner axis/sign, LED connections and power, permissions, and firmware compatibility remain observed installation facts. Windows probe support and physical tests remain separate from Mac compilation and Linux CI. Do not run device commands unattended or change firmware/maps during automated verification.
