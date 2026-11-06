# Continue development in separate sessions

Read [how the instrument fits together](architecture.md) before changing its timing or audio routes. Use the [practice contract](../ui/practice/CONTRACT.md) for commands and state, and the [practice guide](../ui/practice/README.md) to perform a take.

The [four-workstream planning brief](workstreams.md) records the current priorities: slapback patches, the Performance Engine and deterministic chart compiler, peripheral management, and the Video Assistant. It supersedes the initial UI-only and audio-hosting-first assignments below.

The [canonical-data and retention policy](data-retention.md) governs promotion and cleanup. Preserve completed designs and concise lessons rather than every experiment. Figma owns promoted animation. Git owns canonical effects and tools. Operator authoring data needs a database sidecar and independent backup; current browser SQLite storage does not yet satisfy that target. Review temporary material at milestone handoff and during periodic housekeeping, after verifying the canonical handoff.

The [deterministic command plan](implementation/deterministic-pipelines.md) separates product validation from harness recovery. Product blocks require an operator-facing explanation and suggested next steps when driven by an agent. Harness failures hand control to Chief. Shared CLI diagnostics live in `scripts/lib/command-diagnostics.ts`; domain code owns the actual validation rules.

## Run deterministic product commands

Use the [native performance guide](../lib/performance/README.md) for chart options and source mappings. Each command publishes one output. Inspect the JSON before encoding the exact inspected file for the engine.

```sh
./show-tools chart compile --source SOURCE.json --mapping MAPPING.json --out SONG.json
./show-tools chart inspect SONG.json
./show-tools chart encode --song SONG.json --out SONG.pfp
```

The removed `--native-out` option reports a migration instruction. A draft can be inspected but cannot be encoded for execution. Add `--json` to receive a structured failure without preceding human output.

Use the [audition guide](../lib/patches/tools/README.md) to render approved shared effects from explicit synthetic or WAV input. Supply both linear gains and a fresh output directory.

```sh
node --import tsx scripts/audition-patches.ts --source synthetic --rate 48000 --patch tribulations-guitar --input-gain 1 --output-gain 1 --out /tmp/guitar-audition
```

The pack contains dry, processed, and exact-duplicate controls. It performs no automatic gain correction or loudness matching. Existing packs are preserved. The manifest records the actual input, gains, hashes, and frame counts; toolchain provenance is separate.

The [canonical animation guide](../assets/video/published/README.md) describes generating complete Figma read scripts and checking captured output. These commands preserve the existing pixel, visible-scene, layer, and HOLD gates. They do not edit Figma or promote artwork by fallback.

Run the allowlisted CAD fit-trial workflow with an explicit installed CAD Python and a fresh absolute output directory.

```sh
hardware/cad/cad candidate measured-hex-joint --python /absolute/path/to/cad/python --output /absolute/path/to/new-trial --json
```

The command runs the existing negative checker before export and verifies the actual receipt and file hashes. Its result covers an isolated two-piece fit trial, not the complete mount or physical fit. It does not discover services, publish to a viewer, or start live services. Runtime and protocol failures return to Chief. A final checked receipt marks a consumable export. Partial output without that receipt is untrusted; ask Chief to inspect it and rerun into a fresh directory.

Run the changed command checks without starting live services.

```sh
node --import tsx --test scripts/tests/command-diagnostics.test.ts scripts/tests/chart-compiler.test.ts scripts/tests/audition-patches.test.ts
npm run test:figma-exports
npm run test:cad-commands
/absolute/path/to/cad/python -m unittest discover -s hardware/cad/tests -p test_headless_candidate.py
npm run typecheck
```

CAD Python checks require the environment from `hardware/cad/requirements.lock`. Missing verification dependencies are a Chief recovery task. Expected negative fixtures do not require operator notifications. Unexpected product blocks encountered while carrying out an operator request do.

## Give each session its own checkout

Create separate worktrees before running agents concurrently. This separates source edits, the Git index, dependencies, and generated `dist/` files.

```sh
git worktree add ../show-tools-filters -b work/filters
git worktree add ../show-tools-ui -b work/ui
git worktree add ../show-tools-elitedesk -b work/elitedesk
```

Run those commands after the handoff documentation commit lands. Start each session in its assigned directory. Commit verified milestones there. Integrate one branch at a time and rerun the affected checks after resolving overlaps.

Assign one owner to a shared contract change before editing it. The likely overlap points are `lib/performance/include/performance_engine.h`, `lib/performance/wasm-performance.ts`, `lib/sequencer/include/audio_sequence_engine.h`, `lib/sampler/include/sample_engine.h`, `lib/performance/model.ts`, `ui/practice/audio.ts`, `ui/practice/practice-worklet.ts`, `ui/practice/app.ts`, and `scripts/build-ui.ts`. Separate worktrees prevent accidental overwrites. They do not resolve conflicting designs for these files.

For native hosting, follow the [EliteDesk inventory procedure](operations/elitedesk-inventory.md) and [handoff](operations/elitedesk-handoff.md). Hardware - EliteDesk owns host and device adapters; Performance Engine owns shared musical and clock contracts. The remote-desk milestone keeps audio on the EliteDesk while a locally served browser UI sends controls. Until the device adapter exists and passes its checks, native library tests establish PCM behavior only. Restricted agent messaging does not authorize host or audio changes.

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

The merged [effects plan](plans/filters-and-patches.md) records operator decisions. Start with portable live-first processing and processed stereo caches, not sample-only effects or dry primary takes. Keep button bindings separate from logical voices. Use web controls for venue parameter tuning; performance peripherals invoke declared cues/operations.

The [patches module](../lib/patches/README.md) supplies ordered Slapback and Chorus stages for the six prepared practice profiles and evolving processed caches. Run its reproducible check from the repository root.

```sh
node --import tsx scripts/verify-patches.ts
```

That command builds and runs the same C++ tests natively and through Emscripten, then compares rendered interleaved stereo float fixtures. It includes the canonical [Tribulations guitar](../lib/patches/TRIBULATIONS.md) tests and approved synthetic PCM probes. That fixed factory has no production voice or ABI binding yet; coordinate that integration with Performance Engine. It saves generated artifacts in a fresh temporary directory. Tests cover generic stage order, mono left/right output, exact processed capture, and state-driven cache release at arbitrary reached stop positions. Prepared snapshots include complete delay and LFO state. END transfer joins a phrase at capture cutoff, consumes declared zero-source suffixes, and evolves original source across wraps. Playback remains unit-speed. These checks do not establish hardware callback performance.

Coordinate performance headers, generated ABI, compiled cache preparation, stems, and browser routes with Performance Engine before editing. ABI 7 and compiled packet/schema 5 retain captured prefixes, logical periods, group anchors, millisecond cue windows, and native tempo-hit observations while adding six independently prepared profiles, native graph readback, and source-located rotation windows. The practice page records native sample/click and processed-live buses once each; live monitoring requires explicit physical-device confirmation. Compiled capture uses stopped preparation and switches routes immediately on arm. Its prepared endpoint snapshot joins a phrase without seeking or duplicating the outgoing live tail. Legacy and generic raw capture reject with effects enabled.

Read these files before choosing the processing order.

- `lib/sampler/src/sample_engine.cpp` owns capture, sample storage, voice rendering, and channel gain and mute.
- `lib/sampler/include/sample_engine.h` defines its C interface.
- `lib/performance/src/performance_engine.cpp` owns block processing, transport, chart actions, and click rendering.
- `lib/performance/include/performance_engine.h` defines the complete engine interface.
- `lib/performance/wasm-performance.ts` bridges browser blocks and declarative song data to C++.
- `ui/practice/audio.ts` owns device access, the two processed recording stems, and the separately gated live monitor.
- `ui/practice/practice-worklet.ts` routes controls and publishes native events.
- `lib/performance/model.ts` owns shared commands and state shapes.

Process live voice first and cache the processed result before destination gains. Replay printed PCM without its baked stack. Preserve exact musical cache intervals and natural release tails with a bounded state representation. Stop/Panic must gate live input and clear state; Start restores song defaults. Retrospective commits need matching already-processed history, not raw-source substitution. Keep DEBUG artifacts, practice INFO, and performance WARN formatting and IO outside processing.

Use rendered PCM, native/WASM comparisons, allocation checks, and a browser take once the actual route is integrated. Keep hardware callback deadlines, physical microphone quality, and output device classification separate from fixture claims. Record remaining sparse-hit, resampling, parameter automation, route switching, and loop-seam work explicitly. Commit every verified milestone.

## Start the UI workstream

Begin with `ui/practice/index.html`, `style.css`, and the render and input code in `app.ts`. Use `PracticeAudio` commands and subscriptions for instrument behavior. Keep song-specific names and actions in the chart snapshot and song module.

The practice desk uses browser-default audio devices. Choose the microphone and output in browser or system sound settings before Start. Do not add device enumeration or sink switching to its startup path.

Preserve Q/W over A/S, Escape-to-Panic, native light states, unity sample gains, automatic microphone setup, and automatic demo recording. Keep the mandatory lead-in click independent of the song-click preference. Keep recording preparation and MP3 export states visible and prevent a new take from replacing an export in progress.

Run the practice lifecycle tests and inspect both narrow and desktop layouts in a browser. Exercise focused inputs, repeated Start, Stop during microphone setup, song switching, and download completion. Save any take you need before reloading the page.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, and ui/practice/CONTRACT.md. Iterate on the practice UI under ui/. Keep musical state and chart actions in the audio engine, and keep songs loadable from songs/. Preserve the established keyboard layout, cue lights, capture workflow, and recording lifecycle. Verify the changed interactions in the browser at mobile and desktop widths. Coordinate shared app.ts or audio.ts edits with the other workstreams. Commit each verified milestone.

## Start the EliteDesk workstream

Read the [confirmed hardware inventory](hardware-inventory.md) and the operator's PR #3 review before revising this plan. Unknown installation facts block their dependent design decisions; ask the operator rather than selecting a controller, role, cadence, or API by assumption. The inventory and current workstream brief supersede speculative examples below.

Begin with [the native performance guide](../lib/performance/README.md), `lib/performance/include/performance_engine.h`, and `lib/relay/README.md`. Build and test the complete native engine before adding device code. Its manual-tempo CMake target already links the clock, sequencer, and sampler without aubio or libsndfile.

Choose an audio-device backend and give one thread ownership of the performance engine. Clear each output block, pass microphone PCM to `pf_process()`, and route the rendered channels to the device. Do not also call `bt_process()` or dispatch `sq_on_beat()` on the borrowed component handles. The performance engine owns those calls.

Use `pf_load_compiled_bytes()` to load the compiler's portable `.pfp` artifact while stopped. Browser song modules use the same numeric tables through `pf_configure_compiled()`. No JavaScript runtime is required to execute those instructions. The device service remains future work.

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

## Verify the independent video studio

For song composition, use the [director guide](video-directors/README.md) and [session registry](video-directors/registry.json). Directors own separate song pages; shared-library changes go through Art. Serialize Figma calls with the documented cooperative file lease, and give implementation work its own checkout. The guide marks MusicXML source paths as pending authoring-branch references; they are not merged renderer inputs.

Use `npm run build:video` to build the C++ held-frame sampler to WASM and bundle `ui/video/` without requiring the practice WASM artifact. Prepare a private Street score from the saved catalog and verified Figma asset package, then serve it with its referenced assets on an isolated port. The [studio guide](../ui/video/README.md) documents preparation, explicit-time inspection, and clean movie export. Run `npm run test:video` and the focused exporter tests before reviewing the actual browser scene and decoded movie frames. Keep private catalog exports and prepared binding receipts outside Git. Video Agent owns Figma writes and asset verification; the runtime owner consumes its handoff. Keep full-song chart interpretation, live per-voice PE delivery, and real CRT output claims separate from the authored fixture. Coordinate shared build packaging with Performance Engine; the video builder preserves other `dist/` entries.

Use `scripts/prepare-street-song.ts` for the complete chart-planned score. It shares the fixture's actor-local visual policy and native sampler. Pair the current frozen source with its matching mapping, and use the private saved catalog only for qualified cast bindings. Scene and private `preparationReceipt` publish together as one atomic JSON file; output must not alias any input. Test forward subdivision parsing, blank/dash intensity rules, independent actor cadence, main/backup section boundaries, and publication failure preservation. Keep source-located diagnostics strict. Verify the actual movie with corrected identity-approved artwork before calling the art finished.

Presence/effect staging uses an independent native HOLD lane alongside each actor's original dance track. Check direct and reverse seeks, effect-only composition-cache changes, colored effects over gray bodies, and partial effect-resource cleanup. `scripts/video-expansion/poof-release.mts` owns admission of the pinned approved Figma poof catalog and exact18 PNGs; run its focused tests separately. Opaque-peak coverage must use actual transition drawings and their recorded pivots, including padded special/ultra canvases.

Run `node --import tsx scripts/verify-street-presence.ts SCENE ASSET_ROOT WASM NEW_REPORT_JSON` on a prepared presence scene before movie export. It samples the real native tables at each visibility edge, checks outgoing and incoming combined sprite pixels against the opaque peak, and rejects occupied cloud clipping across all six drawings of every used variant. Neighbor overlap remains an explicit visual-review diagnostic. The report binds scene, WASM and loaded PNG hashes; its output path must be new.

Video pipeline commands share `scripts/cli-entry.ts` to resolve executable identity through filesystem aliases. Verify CLI invocation through a checkout symlink as well as its physical path; importing the programmatic API must not run the command.

## Prepare the arrived I-PAC harness

Start a returning bench session with [Resume the Mac bench test](guides/ipac-mac/resume-bench.md). Read the [installed state](hardware-inventory.md#installed-bench-state) before assigning inputs or changing wiring. The [bench verification record](guides/ipac-mac/bench-verification.md) separates physical observations, packaged diagnostics, and remaining work.

Use the [confirmed inventory](hardware-inventory.md) and [peripheral wiring guide](../lib/peripherals/README.md) for the complete harness. `npm run test:peripherals` builds native diagnostics, processes synthetic PCM through the current C++ engine, and compares portable native/WASM results without opening devices. `npm run peripherals:summary -- /path/to/probe.ndjson` summarizes an operator recording without assigning musical meanings.

The [logical LED API](../lib/peripherals/LIGHTS.md) has portable native/WASM fixtures and explicit timing inputs. Its evaluator is independent of live PE publication and hardware delivery. PE owns musical activation, keyframes, quantization, continuous phase, and tempo changes. A host must consume PE-authored output rather than schedule musical patterns from BPM or message arrival. Keep run, clock-epoch, device-session, and binding-revision gates at the coordinated caller boundary.

The native `peripheral-probe` provides explicit `list`, `listen`, and guarded `led` commands for Mac and Linux. Build/help/tests perform no hardware IO. Actual key maps, spinner axis/sign, LED connections and power, permissions, and firmware compatibility remain observed installation facts. Windows probe support and physical tests remain separate from Mac compilation and Linux CI. Do not run device commands unattended or change firmware/maps during automated verification.

## Verify the compact voice desk

Use each voice footer to edit an ordered stack while stopped. Native applied readback owns the summary; unsaved drafts must remain visibly unapplied. Verify changing one voice leaves another voice and its compatible capture banks unchanged. Existing retained takes keep their recorded graph. Test the serial backup Slapback and Chorus stack with nonzero rotations inside a marked interval, strict next-quarter-count grid release, tempo changes, window exit, and Stop. Zero and duplicate observations cannot extend the grid deadline. Physical knob mapping remains an installation task.

Check Space on a focused effect disclosure or button before checking the body-level transport shortcut. Escape must still Panic while editing. Capture desktop and 390px screenshots from the integrated app, including expanded two-stage backup settings. Keep pad targets stable during count-in and recording. The layout comparison and verification contract are in [the desk rehab guide](implementation/practice-desk-rehab.md).

### Voice catalog/editor work

The [catalog migration core](implementation/catalog-migration.md) is a preparation milestone. Run `node --import tsx --test lib/voice-catalog/tests/*.test.ts` for migration and pure replica fixtures. Native SQLite backup/reopen fixtures use `node:sqlite` on temporary files. They do not create a sidecar service or migrate an operator library. Keep the current v2 browser target explicit until worker, cache, editor and Video callers move together. Host and backup configuration remain operator decisions.

`lib/voice-catalog/` owns the SQLite domain and source bindings; `ui/practice/catalog-worker.ts` owns durable IndexedDB snapshots; `catalog-client.ts` owns asynchronous worker requests. `voice-catalog.ts` connects saved authoring data to the existing stopped native preparation boundary. `voice-library.ts` owns the shared inspector and compact ensemble presentation. Coordinate changes to `app.ts`, `voice-effects.ts`, and build packaging with PE. Video owns the shared character registry; don't seed voice assignments or rename canonical IDs to artwork variants.

`npm test` includes real SQL.js WASM transactions, source discovery, and reconciliation checks. `npm run build:ui` copies the matching SQL WASM, preview avatars, library CSS, and catalog worker into the offline cache; its audio dependency check still rejects package runtimes in the worklet. Browser verification must also exercise durable reopen, concurrent tabs, failed IndexedDB writes, JSON/SQLite backups, character save/reload, unmapped voices, and stopped native readback without microphone startup. The three [design studies](../ui/practice/studies/voice-editor/README.md) document the final combination. Keep their synthetic state out of runtime defaults.

## Review physical CAD in the tabbed desk

The independent [CAD desk](../ui/cad/README.md) lives under `ui/cad/`; its local publisher service lives under `hardware/cad/`. Keep OCP Viewer on port 3939 running, then use `hardware/cad/cad desk --disco-step '/absolute/path/to/Disco Ball.step'` and open <http://127.0.0.1:3940/>. This tool uses the isolated CAD environment and does not start audio, Sheets, Chrome CDP, USB listeners, or printer jobs.

The box-mount, disco-bar, mushroom-mount, and micro-enclosure sessions own separate CAD files and headless checks. The coordinator owns the desk and shared viewer publication. Run `node_modules/.bin/tsc --project ui/cad` for its browser code, and use the [CAD workspace guide](../hardware/cad/WORKSPACES.md) for geometry checks and manufacturing gates. The practice desk remains the supported musical instrument UI.

Cue-row changes belong to the authoring/compiler boundary in `lib/voice-catalog/cue-mapping.ts`, not browser beat dispatch. Verify version-one SQLite/JSON migration, cue-reference round trips, stale-label rejection, exact voice/worksheet selection, and preservation of loaded native instructions until an inspected song is explicitly loaded. The library worker returns version-two documents; older JSON backups are decoded and migrated at import. Static screen avatars use only saved character IDs and do not replace source-owned pad names or native activity labels.

Compiled captures automatically complete at their authored source endpoint if their finish cue is missed. Verify missed commits, same-frame incoming arms, rejected commit-and-arm starts, and manual-versus-automatic PCM equality at 44.1 and 48 kHz. The native completion transaction owns this deadline. Latest practice snapshots expose take readback for the pad annotations. Historical event snapshots do not acquire later take state.

Validate the static character handoff with `node --import tsx scripts/video-expansion/check-static-avatars.mts`. This checks all 51 IDs, image hashes, dimensions, and transparency. `npm run check:layout` also compares every built avatar with its published source and checks its offline-cache entry. The 46 gallery previews are static UI art and have not passed the finished-animation repaint review.

Verify explicit prefix views with dry and effected PCM at 44.1 and 48 kHz. Place the omitted hit on an independent absolute musical grid; deriving its frame from a rounded loop period can leak a sample. Check a subsequent full view, retained-bank replacement, zero-length admission after late arming, and unchanged manual Play/Stop behavior. Full DYC verification covers all 218 bars and initial preparation of its 12 takes. Prefix views add no recordings.

## Direct scenes and character actions through storyboards

Use the [pixel-storyboard skill](../skills/pixel-storyboard/SKILL.md) for scene composition, character actions and tween studies. The [operator instructions](../skills/pixel-storyboard/references/operator-guide.md) explain the review sequence. Establish the starting and ending poses, then draw the middle and split the remaining gaps. Even a complete-motion request follows that sequence.

Keep art authoring and musical execution separate. A Figma held-pose animatic tests drawings and provisional timing. It does not establish live PE synchronization or runtime promotion. Verify the actual Figma export and preserve independently accepted pose, face, finish and timing decisions. The skill's [Maestro case](../skills/pixel-storyboard/references/maestro-case.md) records the evidence behind this workflow.
