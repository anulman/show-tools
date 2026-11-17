# Continue development in separate sessions

Read [how the instrument fits together](architecture.md) before changing its timing or audio routes. Use the [practice contract](../ui/practice/CONTRACT.md) for commands and state, and the [practice guide](../ui/practice/README.md) to perform a take.

The [four-workstream planning brief](workstreams.md) records the workstream priorities. The commands and ownership below describe the current implementation. Historical plans do not override them.

The [canonical-data and retention policy](data-retention.md) governs promotion and cleanup. Preserve completed designs and concise lessons rather than every experiment. Figma owns promoted animation. Git owns canonical effects and tools. Operator authoring data needs a database sidecar and independent backup; current browser SQLite storage does not yet satisfy that target. Review temporary material at milestone handoff and during periodic housekeeping, after verifying the canonical handoff.

The [deterministic command plan](implementation/deterministic-pipelines.md) separates product validation from harness recovery. Product blocks require an operator-facing explanation and suggested next steps when driven by an agent. Harness failures hand control to Chief. Shared CLI diagnostics live in `scripts/lib/command-diagnostics.ts`; domain code owns the actual validation rules.

## Run deterministic product commands

Use the [canonical MusicXML guide](implementation/musicxml-cutover.md#commands) for chart inputs and the [native performance guide](../lib/performance/README.md) for engine compilation. Inspect the canonical document, compile it to reviewable JSON, then encode that exact derived file. Compilation also prints the inspection report. Each output command publishes one file.

```sh
./show-tools chart inspect SONG.musicxml
./show-tools chart compile --musicxml SONG.musicxml --out SONG.json
./show-tools chart encode --song SONG.json --out SONG.pfp
```

Sheets JSON and mapping are ingestion inputs for `chart musicxml`, not inputs for `chart compile`. A Sheets reimport creates an explicit canonical revision. The removed `--native-out` option reports a migration instruction. A draft can be inspected but cannot be encoded for execution. Add `--json` to receive a structured failure without preceding human output.

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

For compiled physical cue feedback, `ctest --test-dir BUILD -R 'cue_lights|compiled_program'
--output-on-failure` exercises the native two-count warning, full-bar acceptance,
count-in, practice bounds, loops, tempo changes, priority, and allocation-free
readback. Build `lib/performance` with CMake first. These tests verify engine
publications; physical USB delivery and visible LED behavior remain separate checks.

## Give each session its own checkout

Create separate worktrees before running agents concurrently. This separates source edits, the Git index, dependencies, and generated `dist/` files.

```sh
git worktree add ../show-tools-filters -b work/filters
git worktree add ../show-tools-ui -b work/ui
git worktree add ../show-tools-elitedesk -b work/elitedesk
```

Run those commands after the handoff documentation commit lands. Start each session in its assigned directory. Commit verified milestones there. Integrate one branch at a time and rerun the affected checks after resolving overlaps.

Assign one owner to a shared contract change before editing it. The likely overlap points are `lib/performance/include/performance_engine.h`, `lib/performance/wasm-performance.ts`, `lib/sequencer/include/audio_sequence_engine.h`, `lib/sampler/include/sample_engine.h`, `lib/performance/model.ts`, `ui/practice/audio.ts`, `ui/practice/practice-worklet.ts`, `ui/practice/app.ts`, and `scripts/build-ui.ts`. Separate worktrees prevent accidental overwrites. They do not resolve conflicting designs for these files.

For native hosting, follow the [EliteDesk inventory procedure](operations/elitedesk-inventory.md) and [practice quickstart](practice-quickstart.md). Hardware - EliteDesk owns the existing native ALSA host and peripheral adapters. Performance Engine owns shared musical and clock contracts. The persistent gateway serves the desk while audio stays on the native host. Native fixtures establish PCM and lifecycle behavior; installed device readiness and physical behavior require target evidence. Follow the [handoff guide](implementation/lean-handoff.md) to keep source evidence separate from host capability and readiness.

Treat the Sheets helper and its Chrome profile as shared state too. Use one owner for a live chart-follow test so different practice sessions do not compete to select columns.

## Build a browser checkout

Install Node.js, npm, Emscripten with `em++` and `emcmake` on `PATH`, CMake, and Ninja. From the assigned worktree, run these commands in order.

```sh
npm ci
npm run build
```

The full build compiles the C++ performance engine, clock, sequencer, and sampler into one manual-tempo WASM module. It runs clock checks, bundles the browser code, and writes static assets into `dist/`. Run `npm test` for engine and practice integration checks. Publish a verified immutable snapshot through the UI manager.

`npm run build:wasm` keeps CMake/Ninja objects and compiler depfiles under `lib/beat-tracker/build-manual-wasm/cmake`. It recompiles C++ units whose source or included headers change. The entrypoint still regenerates the ABI and exports, checks the toolchain, and runs the manual WASM tests on every invocation. It preserves the existing `EM_CACHE` override. Remove the `cmake` subdirectory for a fresh object build without discarding the Emscripten system-library cache.

Do not infer bundle equivalence from a Git tree, lockfile, and old esbuild input hashes alone. Installed package `main` or `exports` metadata and new higher-priority resolution paths can change fresh output while those values stay unchanged. The rejected gateway cache needed a complete installed dependency fingerprint whose measured cost exceeded fresh bundling. Compiler-owned depfiles avoid that custom cache for WASM.

```sh
./show-tools ui preview
```

The manager prints the worktree’s permanent URL and actual build revision/cache identity. `npm start` runs the same command. Use `--session NAME` for a separate browser library within the same worktree. Do not launch ad hoc static servers or choose another port when one is occupied; the manager fails closed and leaves its existing owner untouched.

After a reviewed merge, `./show-tools ui live --publish origin/main` builds that merged revision in an isolated checkout and publishes it at `http://127.0.0.1:8084/`. `ui live` reuses the last publication. This does not fetch automatically. Follow the [UI manager guide](ui-manager.md) before the first handover from a legacy server.

For browser-only changes, run `npm run build:ui` after the first full build. Run `./show-tools ui preview` after rebuilding, then reopen its printed stable URL. Existing pages keep their pinned release. That command needs the generated `ui/practice/wasm/manual-clock.wasm` to exist and replaces `dist/`; it does not rebuild C++.

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

## Continue the EliteDesk workstream

Read the [confirmed hardware inventory](hardware-inventory.md), [native host guide](../lib/native-host/README.md), and [session CLI guide](implementation/session-cli.md). Unknown installation facts block their dependent decisions. Ask the operator rather than selecting a controller, role, cadence, or API by assumption.

The existing `native_alsa_host` connects the complete C++ engine to explicit ALSA capture and playback devices. `native_fake_host` exercises the same engine and IPC with synthetic PCM. The persistent gateway owns native process attempts and exposes authenticated controls. Help and status open no audio device. Use the supported session commands and confirmed profile rather than choosing another backend.

Preserve one audio thread's ownership of the performance engine when changing the host. Pass microphone PCM to `pf_process()` and route its rendered channels to the device. Do not also call `bt_process()` or dispatch `sq_on_beat()` on borrowed component handles. The performance engine owns those calls.

Use `pf_load_compiled_bytes()` to load the compiler's portable `.pfp` artifact while stopped. Browser song modules use the same numeric tables through `pf_configure_compiled()`. No JavaScript runtime is required to execute those instructions. The native host accepts the packet and explicit effect profiles while stopped.

Preserve bounded native event transfer from the engine's owning thread and IPC serialization outside the device callback. Do not query the engine concurrently from an observer thread. Preserve source audio-frame timestamps. A network receipt is not a musical boundary.

Keep reset and fresh-audio operations that may allocate outside the processing callback. Audit native device buffers, command queues, and lifecycle behavior directly. Preserve capture bounds, commit-and-autoplay, replacement capture, channel gain and mute, explicit stops, and song position.

The existing Mac and Linux peripheral adapters submit identified physical input through the gateway. Songs declare musical bindings, and C++ resolves them. Installation profiles contain observed interfaces and output mappings. Keep physical ingress separate from browser and network control. Starting the relay does not attach a peripheral or establish installed readiness.

Use this starting brief for a new session.

> Read AGENTS.md, docs/architecture.md, docs/development.md, lib/native-host/README.md, and lib/peripherals/README.md. Extend the existing native host, persistent gateway, and identified peripheral adapters. Keep musical timing and rendering in C++. Verify the changed ownership and lifecycle boundaries with synthetic fixtures. Record target acceptance separately. Preserve active performances and commit each verified milestone.

## Verify and report the changed behavior

For [the shared-session tuner](implementation/tuner.md), run the native and WASM tuner tests, then build the desk and run `node --import tsx scripts/build-tuner-check.ts`. Publish the check through `./show-tools ui preview --session tuner-check`. Open `/tuner-check/index.html?test=1` at the printed origin and click **Run shared tuner checks**. This fixture supplies synthetic C3 input through the desk's own context and counts context creation and microphone acquisition. Verify the displayed result in a real browser. It does not test an installed microphone. Include tuner changes in native release source-equivalence checks and Linux CI triggers.

Build the fake native host at `build/native-host/native_fake_host` before `npm test`, or set `NATIVE_FAKE_HOST` to its built path. The default suite includes the real native IPC vertical test and fails if the executable is missing. Run the common checks from the worktree root.

```sh
npm run typecheck
npm test
npm run check:layout
```

Run `npm run build` when C++ or generated assets change. Run `npm run build:ui` for browser changes after WASM exists. Tests use local sockets for relay and helper fixtures, so a sandbox that prohibits listening can cause permission failures.

Use [native performance build and test instructions](../lib/performance/README.md#build-and-test-the-native-engine) for complete engine changes. The root test command does not prove the native CMake build. The [sampler target](../lib/sampler/README.md#build-and-test-the-native-sampler) and [tracker target](../lib/beat-tracker/README.md#build-the-native-module) remain available for narrower changes. Optional GPL follower checks use `npm run test:follower` after building the full follower artifact as described in the tracker guide.

For audio changes, inspect rendered PCM and exercise the browser path that users run. For Sheets changes, observe intermediate frames as well as final selection. The earlier viewport test missed visible jumps because it checked only the final state.

Record each check's inputs, verdict, evidence path, and limitations using the [handoff guide](implementation/lean-handoff.md). Historical migration results below describe those runs, not the current checkout's acceptance. After the complete performance migration, the default suite passed 169 tests with two optional follower skips. The follower-enabled suite passed all 171 tests. Both WASM builds, typecheck, browser build, and layout checks passed. The native CMake target passed all three component tests. AddressSanitizer, undefined-behavior, and float-cast-overflow checks also passed. Separate worklet tests verified click PCM frame by frame, reset and mute tails, analyzer isolation, and bounded telemetry.

Chrome verified the production adapter with synthetic microphone input. Four native lead-in clicks remained audible with song click off. Capture retained exactly two bars as 88,200 frames at 44,100 Hz, autoplay began on bar 3, MP3 export decoded into two audible channels, and Stop left zero active voices. Physical microphone quality, phone behavior, the complete installed extension path, and EliteDesk device behavior remain separate verification tasks.

## Verify performance contracts

Use the [formal verification guide](../verification/README.md) when changing native audio lifecycle, capture publication and handoff, or canonical MusicXML meaning. `npm run verify:formal` runs all three packages sequentially after the documented checker setup. Each package checks its declared bounds, actual-code witnesses, and deliberate source mutations. Read the package contract before advancing a source synchronization record. A bounded model pass does not prove every implementation trace or physical audio behavior.

## Keep the handoff current

### Build from canonical MusicXML

Read [the cutover guide](implementation/musicxml-cutover.md). `show-tools chart compile --musicxml SONG.musicxml --out SONG.json` followed by `show-tools chart encode --song SONG.json --out SONG.pfp` produces disposable compiled artifacts. `show-tools chart inspect SONG.musicxml` reads the canonical document. The Sheets `fetch`, workbook `import`, and `musicxml` commands are ingestion boundaries and require their mapping configuration.

For multi-bar captures committed with `clb`, run `lib/performance/tests/capture-slices.test.ts` and the native CTest suite. Verify exact slice heads, count-based source cutoffs, original DSP checkpoints, evolving loop seams, phase-preserving switches, zero-source tails and no audio-thread allocation. `clb` commits at the start of its written bar and selects the last completed bar; source capture is bounded even if the commit press is missed. Native packet 6 window rows contain selection, source beginning, exclusive end and loop period. Full-song verification must use the current canonical document; frozen cutover evidence remains separate.

Run `node --import tsx scripts/verify-musicxml-cutover.ts`, the `musicxml-song`, `musicxml-authoring`, `musicxml-cutover` and musician tests, and `npm run typecheck`. Run `npm run verify:dyc` for complete native/WASM conformance at 44.1 and 48 kHz. Do not restore JSON source/mapping fallbacks. MusicXML edits must invalidate semantic hashes, and removing audit archives must change no compiled or printed meaning.

Build the optional bound-Sheets package with `node --import tsx scripts/build-sheets-musicxml.ts --out-dir NEW_DIRECTORY`. `scripts/sheets-musicxml/` owns the Google service adapter; `ui/sheets-musicxml/` owns the download dialog. Run `scripts/tests/sheets-musicxml.test.ts` alongside the exporter tests. The [installation guide](implementation/sheets-musicxml.md) distinguishes VM/browser fixture checks from actual Google authorization and installation. Keep generated Apps Script files and ZIPs outside Git.

Generate individual non-AF handouts with `scripts/build-musician-sheets.ts`; the [musician-sheet guide](implementation/musician-sheets.md) documents its inputs and optional isolated PDF dependencies. Run `lib/performance/tests/musician-sheets.test.ts` alongside the exporter and Sheets tests. Verify all bars, five blank staff lines, source arrangement marks and vocal cues, including lyric-bearing instrumental sections and partial final systems. Inspect the rendered PDFs separately from XML validation. `output/` is generated and ignored.

For compact handouts, also run `lib/performance/tests/musician-sheet-plan.test.ts`. Expand counted-rest and reference ranges when checking bar coverage; compressed pages deliberately omit individual blank-bar staves. Protect the Drums pickups at 76/160 and entry at 203-205. Check section-heading feel summaries and explicit ranges for internal changes, actual-bar lyric anchors and the vocal-only accent at DYC 143:3&; ordinary playing needs no printed dash. Reuse files require current source/mapping digests and explicit musical confirmation; candidates must not become automatic playback jumps. Regenerate the Sheets package after renderer changes.

Update the practice contract when command or state behavior changes. Update the architecture explanation when ownership or audio routing changes. Keep the module README files current for their commands. Historical `PLAN.md` and `VERIFICATION.md` files describe earlier POCs and do not override current code or tests.

Keep compiled output, recordings, and test artifacts out of commits. The `wasm-abi.ts` files under `lib/sampler/`, `lib/sequencer/`, and `lib/performance/` are checked-in generated source. Regenerate them alongside their C header changes. Increase the performance ABI version when changing its binary contract. A verified source change and its relevant documentation belong in the same milestone.

## Verify the independent video studio

Use `./show-tools scenes` for shared scene-script persistence and the [scene authoring guide](video-directors/scene-authoring.md) for the operator-confirmed database path and workflow. Run `node --import tsx --test lib/video/scene-authoring/tests/*.test.ts scripts/tests/scene-authoring.test.ts` and `npm run typecheck` after changes. Tests use temporary real SQLite files, never an operator library. Keep JSON as transport or derived output, preserve original inputs, and leave unknown ranges and stages explicit. Scene authoring adds no services, musical clock or runtime admission. Independent off-machine backup remains unconfigured.

For song composition, use the [director guide](video-directors/README.md) and [session registry](video-directors/registry.json). Directors own separate song pages; shared-library changes go through Art. Serialize Figma calls with the documented cooperative file lease, and give implementation work its own checkout. Canonical MusicXML is the chart input for complete-song Video preparation.

Use `npm run build:video` to build the C++ held-frame sampler to WASM and bundle `ui/video/` without requiring the practice WASM artifact. Prepare a private Street score from the saved catalog and verified Figma asset package, then serve it with its referenced assets on an isolated port. The [studio guide](../ui/video/README.md) documents preparation, explicit-time inspection, and clean movie export. Run `npm run test:video` and the focused exporter tests before reviewing the actual browser scene and decoded movie frames. Keep private catalog exports and prepared binding receipts outside Git. Video Agent owns Figma writes and asset verification; the runtime owner consumes its handoff. Keep full-song chart interpretation, live per-voice PE delivery, and real CRT output claims separate from the authored fixture. Coordinate shared build packaging with Performance Engine; the video builder preserves other `dist/` entries.

Use `scripts/prepare-street-song.ts` for the complete chart-planned score. It shares the fixture's actor-local visual policy and native sampler. Supply the canonical MusicXML song and verified asset scene. An embedded voice snapshot is authoritative for that song. Otherwise supply the saved catalog as an explicit fallback for qualified cast bindings. Scene and private `preparationReceipt` publish together as one atomic JSON file; output must not alias any input. Test forward subdivision parsing, blank/dash intensity rules, independent actor cadence, main/backup section boundaries, and publication failure preservation. Keep source-located diagnostics strict. Verify the actual movie with corrected identity-approved artwork before calling the art finished.

Presence/effect staging uses an independent native HOLD lane alongside each actor's original dance track. Check direct and reverse seeks, effect-only composition-cache changes, colored effects over gray bodies, and partial effect-resource cleanup. `scripts/video-expansion/poof-release.mts` owns admission of the pinned approved Figma poof catalog and exact18 PNGs; run its focused tests separately. Opaque-peak coverage must use actual transition drawings and their recorded pivots, including padded special/ultra canvases.

Run `node --import tsx scripts/verify-street-presence.ts SCENE ASSET_ROOT WASM NEW_REPORT_JSON` on a prepared presence scene before movie export. It samples the real native tables at each visibility edge, checks outgoing and incoming combined sprite pixels against the opaque peak, and rejects occupied cloud clipping across all six drawings of every used variant. Neighbor overlap remains an explicit visual-review diagnostic. The report binds scene, WASM and loaded PNG hashes; its output path must be new.

Video pipeline commands share `scripts/cli-entry.ts` to resolve executable identity through filesystem aliases. Verify CLI invocation through a checkout symlink as well as its physical path; importing the programmatic API must not run the command.

## Prepare the arrived I-PAC harness

Start a returning bench session with [Resume the Mac bench test](guides/ipac-mac/resume-bench.md). Read the [installed state](hardware-inventory.md#installed-bench-state) before assigning inputs or changing wiring. The [bench verification record](guides/ipac-mac/bench-verification.md) separates physical observations, packaged diagnostics, and remaining work.

Use the [confirmed inventory](hardware-inventory.md) and [peripheral wiring guide](../lib/peripherals/README.md) for the complete harness. `npm run test:peripherals` builds native diagnostics, processes synthetic PCM through the current C++ engine, and compares portable native/WASM results without opening devices. `npm run peripherals:summary -- /path/to/probe.ndjson` summarizes an operator recording without assigning musical meanings.

The [logical LED API](../lib/peripherals/LIGHTS.md) has portable native/WASM fixtures and explicit timing inputs. Its evaluator is independent of live PE publication and hardware delivery. PE owns musical activation, keyframes, quantization, continuous phase, and tempo changes. A host must consume PE-authored output rather than schedule musical patterns from BPM or message arrival. Keep run, clock-epoch, device-session, and binding-revision gates at the coordinated caller boundary.

The native `peripheral-probe` provides explicit `list`, `listen`, and guarded `led` commands for Mac and Linux. Build/help/tests perform no hardware IO. Actual key maps, spinner axis/sign, LED connections and power, permissions, and firmware compatibility remain observed installation facts. Windows probe support and physical tests remain separate from Mac compilation and Linux CI. Do not run device commands unattended or change firmware/maps during automated verification.

## Verify the compact voice desk

Use each voice footer to edit an ordered stack while stopped. Native applied readback owns the summary; unsaved drafts must remain visibly unapplied. Verify changing one voice leaves another voice and its compatible capture banks unchanged. Existing retained takes keep their recorded graph. Test the serial backup Slapback and Chorus stack with nonzero rotations inside a marked interval, full quarter-count inactivity release, tempo changes, window exit, and Stop. Zero and duplicate observations cannot extend the inactivity deadline. Physical knob mapping remains an installation task.

Check Space on a focused effect disclosure or button before checking the body-level transport shortcut. Escape must still Panic while editing. Capture desktop and 390px screenshots from the integrated app, including expanded two-stage backup settings. Keep pad targets stable during count-in and recording. The layout comparison and verification contract are in [the desk rehab guide](implementation/practice-desk-rehab.md).

### Voice catalog/editor work

The [catalog migration core](implementation/catalog-migration.md) is preparation for a filesystem authority. Run `node --import tsx --test lib/voice-catalog/tests/*.test.ts` for migration, replica, native adapter and real authority/replica fixtures. Native SQLite transactions and backup/reopen checks use `node:sqlite` on temporary files. They do not create a sidecar service or migrate an operator library. Keep the current v2 browser target explicit until worker, cache, editor and Video callers move together. Host and backup configuration remain operator decisions.

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

## Verify the remote practice instrument

Stop and mushroom Panic share the reserved command slot and cancel older queued ordinary commands. Verify both under HTTP capacity pressure and verify that native Panic preserves its control event while canceling queued Starts. The native priority regression uses a stepped fake host with a long owner interval to fill the bounded queue before it drains.

Build and test `lib/native-host` with CMake. On Linux, install the ALSA development headers in the build environment to compile the device-backed host. The native host tests include fake PCM and Unix socket integration. Then run `node --import tsx --test --test-concurrency=4 lib/remote-performance/tests/*.test.ts ui/practice/tests/remote-session.test.ts` with `NATIVE_FAKE_HOST` pointing to the built `native_fake_host`, or build it at `build/native-host/native_fake_host`. The vertical test requires local Unix and loopback sockets.

Package a registered compiled song with `node --import tsx lib/remote-performance/package-song.ts SONG_ID EFFECTS.json NEW_DIRECTORY`. The new directory contains the derived `manifest.json`, `song.pfp`, and the explicit six-profile `effects.json`. Prepare a stopped host with `node --import tsx scripts/prepare-native.ts SOCKET MANIFEST.json SONG.pfp EFFECTS.json`. The manifest carries the validated compiled presentation and binds the packet and encoded profiles. Preparation regenerates the native packet from that compiled artifact and rejects mismatches before contacting the host. Manifests are limited to 1 MiB. Remote effect edits name one profile and its expected revision; the gateway combines that edit with the current host readback and the native host rejects conflicting writes. This does not provision a device, certificate, token, or deployment. See `lib/native-host/README.md` for explicit daemon arguments.

The practice desk audio mode selector preserves the existing `?remote` gateway path. Verify that a busy browser session blocks switching, that leaving hardware only detaches the client, and that returning to browser mode does not start audio. Check the selector at desktop and 390px widths. Static hosting cannot connect Hardware mode without the gateway.

The persistent gateway is started with `node --import tsx scripts/serve-hardware-desk.ts --profile PROFILE.json`. The version-two profile binds the server, private credentials, validated installed song catalog, private authoring database, restart policy, native executable, and exact device parameters. Starting it publishes an audio-off desk without opening a native socket or device. Authenticated Enable audio creates an owned native process and prepares it stopped; Terminate audio releases it without stopping HTTP. Native commands carry the current attempt and epoch. Update the gateway, shared schemas and `RemoteDesk` together when changing that protocol. Follow the [EliteDesk practice quickstart](practice-quickstart.md) for operator commands and target acceptance.

Identified input attachment includes a client intent recorded before dispatch. The gateway assigns the native slot and session and returns a receipt containing the exact target, source role, binding generation and native admission revision. Bootstrap also supplies an opaque original-owner readback token. Keep these references out of URLs, logs and song exports. Update every gateway, browser and physical-bridge caller together when changing this strict protocol.

Authenticated `POST /api/input-intent-status` reads that original owner's exact intent. It never starts cleanup or grants commands through a replacement client. Readback may await already-started cleanup of that exact source. A lost HTTP reply can recover a server-confirmed admission and retirement; truly unknown native admission stays blocked. Explicit Terminate can resolve it only after the owned controller confirms the old child exited and issues a matching engine-retirement proof. Controller revision and native revision are separate domains.

The initial bounded implementation retains at most 128 owner namespaces, 256 intent identities per owner and 4,096 status reads per owner. Closed owners with no recorded intent or lease are reclaimed. Owners with recorded intents remain retained, including settled identities, so reconnect churn cannot erase recovery or anti-replay evidence. It rejects capacity rather than evicting uncertain ownership or redispatching a reused intent. The controller separately retains 128 confirmed engine targets; missing or pruned proof is unknown. These bounds do not promise unlimited browser reconnects without explicit recovery.

Local browser disposal releases monitoring, microphone acquisition and output connections immediately. Its internal command endpoint remains available until original-source cleanup settles. Server-publisher lease retirement, native input revocation and actual helper output clearing are distinct resources. The current local helper protocol does not acknowledge physical output clearing; HTTP clear success proves only publisher-lease retirement.

Use [the session CLI guide](implementation/session-cli.md) for `./show-tools session start`, `stop`, `status`, and `audio on|off|status`. Help and status acquire no device or CDP process. CLI process tests use an isolated XDG configuration directory and fake service manager; controller/server tests use actual synthetic native processes and Unix/loopback sockets. Verify a second page and reload during an existing performance, cancellation during startup, native faults with the web still available, parent death, and take retention across transport Stop versus loss across Terminate. Actual systemd and ALSA checks remain target deployment evidence.

Build a relocatable Linux release after CI has produced the matching native artifact:

```sh
node --import tsx scripts/build-peripheral-artifact.ts --out NEW_PERIPHERAL_ARTIFACT_DIRECTORY
node --import tsx scripts/build-song-catalog.ts --spec CATALOG_SPEC.json --out NEW_CATALOG_DIRECTORY
node --import tsx scripts/build-session-release.ts --native-artifact NATIVE_ARTIFACT_DIRECTORY --peripheral-artifact NEW_PERIPHERAL_ARTIFACT_DIRECTORY --node-runtime NODE22_DIRECTORY --song-catalog NEW_CATALOG_DIRECTORY --out NEW_RELEASE_DIRECTORY
```

The peripheral artifact builder uses Zig to cross-compile a static Linux x86-64 helper from committed source. It records all compiled repository inputs, compiler identity, flags, source revision, and file checksums. It does not execute the resulting ELF or open hardware. Pass `--compiler PATH` to select the Zig executable.

The release builder requires committed source and an output basename of `show-tools-session-release-<HEAD7>`. It verifies native and peripheral hashes and source equivalence, the reviewed standalone Linux Node executable, and song package integrity. The catalog spec explicitly names each canonical MusicXML input and effects file. Missing effects fail the build; the packager does not choose presets. Production Drunk Girls and Tribulations packaging requires the operator's effects choice or qualified saved effects. Synthetic empty-effects test fixtures are not deployment authoring data.

The version-two release contains `catalog/catalog.json` and all three song packages, including their canonical `source.musicxml`. It rebuilds the shared WASM and browser UI, bundles server/CLI/preparation tools and the three foreground commissioning readers, includes full lifecycle/native review sources, licenses and build provenance, refuses an existing output directory, and writes full file/archive checksums. Optional `--reviewed-revision FULL_SHA` requires the reviewed commit and packaged source to have identical Git trees. Private profiles, tokens and TLS files are installed separately and never enter the archive. The installed `bin/show-tools-session` accepts session subcommands directly. `bin/show-tools-peripheral` supplies peripheral commands without checkout dependencies. Explicit `profile migrate` writes a new V2 profile with the selected release paths; it does not activate that profile or alter services.

Use the [EliteDesk installation handoff](implementation/elitedesk-install.md) for scope, private credential migration, stage-only verification, and target acceptance. Run `python3 scripts/tests/stage-session-release.test.py` for adversarial extraction and idempotent promotion checks. The managed ALSA profile requires explicit identity and monitoring policy; never replace it with a floating default device.

### Connect the laptop I-PAC

Build `lib/peripherals` and read its [persistent host contract](../lib/peripherals/README.md#persistent-mac-device-host).
`./show-tools peripheral connect --config /absolute/path/peripheral.json` connects
the permissioned terminal's local helper to an enabled, stopped hardware-audio
session. It starts no audio or browser. The gateway origin, private token,
optional certificate, helper path and output mapping are explicit configuration.
Do not put temporary USB registry IDs into a song.

Run `node --import tsx --test lib/peripherals/tests/bridge.test.ts` for bounded
ingress, reversal-preserving motion, stale sessions and cleanup ordering. Run the
native peripheral CTest targets as well. The bridge integration test uses a real
gateway/native fake host and synthetic child process without opening USB. Verify
the physical LED and motion thresholds from the permissioned terminal before
declaring the installed instrument ready.

For a direct Linux connection, build the `peripheral-host` target and first run
its read-only `--inspect` command. The [Linux helper contract](../lib/peripherals/README.md#connect-the-i-pac-directly-to-linux)
describes sole-device qualification, explicit access prerequisites and input-gap
behavior. `peripheral_linux_order` tests timestamp merging on Mac and Linux.
`peripheral_linux_runtime` runs real poll/read/write paths against owned pipes on
Linux, including held feedback, native light delivery and failure cleanup. These
tests open no USB or audio devices and do not replace physical acceptance.

### Verify capture parents and the playing view

Take readback appends `PF_TAKE_SELECTION` at field 9; `PF_TAKE_FIELDS` is 10 in the unreleased ABI 8 interface. A playing take reports its actual native selection index only when it belongs to that active selection. Idle and releasing readback use -1, decoded as `selectionIndex: null`. Keep browser/WASM and remote snapshot schemas together when changing this layout.

Run the take-presentation and remote-schema UI tests, `capture-slices.test.ts` at both audio rates, and native compiled-program tests. Current DYC has five capture parents: Cowbell uses two captures with eleven distinct reusable source-bar views. Its shortened bar-82 view is another admission window over the same source bar. A whole-bar slice has a native source cutoff too; display Trimmed only when the selected source span is shorter than its loop period. Derive the playing source bar from native `selectionIndex`, never the chart's displayed current bar. Keep frozen historical doubling tests alongside current-chart tests.

## Verify proposed host delegation without touching the host

The [delegation guide](../lib/remote-performance/delegation/README.md) separates local source preparation from the operator's one-time root bootstrap. Run `node --import tsx --test lib/remote-performance/tests/delegation.test.ts` for temporary-key signatures, unchanged-mailbox fixtures, claim races, replay and audit failures. The existing remote controls CI command includes this wrapper. These checks neither contact the host nor use its production private key. Any frozen checker change needs regenerated pins and independent bootstrap review; an application deployment cannot update the installed authority.

### Verify browser peripheral delivery

Build fresh WASM before testing the physical light publication seam. These tests
use synthetic controls and transport; they do not open the I-PAC.

```sh
node --import tsx --test lib/peripherals/tests/browser-server.test.ts ui/practice/tests/browser-peripheral.test.ts
node --import tsx --test --test-name-pattern='physical LED publications' ui/practice/tests/audio-worklet.test.mjs
```

The local browser bridge has its own loopback server and leaves the managed UI
server untouched. Follow the [peripheral guide](../lib/peripherals/README.md#run-browser-practice-with-the-local-i-pac)
for the one-owner handoff from the audio-free wiring test to browser practice.

Verify explicit app connection routing with `node --import tsx --test lib/remote-performance/tests/connection-options.test.ts`. Owned loopback HTTP/TLS fixtures cover both clients, certificate authority and hostname rejection, original Host/Origin/SNI, literal-IP validation, and HTTP loopback confinement without opening audio or peripheral hardware.

Run `node --import tsx --test lib/remote-performance/tests/client-ca.test.ts` to verify client trust independently of server certificate configuration. The test generates an owned root, intermediate and leaf, serves only the leaf/intermediate fullchain, and exercises default trust and explicit CA bundles in fresh Node processes.

### Verify managed peripheral reconnection

The separate fixed peripheral admission packet lives in `lib/peripherals/delegation/`. Freeze it with `python3 -I lib/peripherals/delegation/freeze.py`, then run `python3 -I -m unittest discover -s lib/peripherals/delegation/tests -v`. These tests exercise real signatures, audit locks and local filesystem boundaries without root or hardware; ownership IDs alone are adapted in bootstrap fixtures. A change here never updates the old web delegation bundle. Exact operator bootstrap, fresh host admission and actual peripheral activation are separate from these local checks; follow the packet README.

`show-tools peripheral serve --config FILE` is the Linux readiness/reconnection
entry point. Run `node --import tsx --test lib/peripherals/tests/managed-runtime.test.ts
lib/peripherals/tests/bridge-integration.test.ts` after building the native fake
host. Owned sockets and synthetic child processes cover audio-off/device waits,
late interface/access metadata, fresh-session reconnect, cleanup before child
replacement, cancellation and SSE silence. These checks open no USB or audio
devices. Live attach during playback additionally requires native same-config
jiggle acknowledgement without resetting its gesture state. The source user-unit
renderer has no installation side effects; installed persistence and actual LED,
button and knob behavior remain target acceptance evidence.


### Verify web startup recovery policy

The session unit renderer preserves the profile's explicit restart policy. An `on-failure` profile retries failed web startup/process exits with a three-second manager backoff and no start-limit cutoff. A `no` profile does not restart automatically. Each fresh server stays
audio-off; native faults under a healthy web process still require explicit
operator recovery. Session CLI tests inspect the concrete unit and refuse silent
replacement of an installed older policy. The server test occupies an owned
loopback listener, proves startup fails without native acquisition, releases the
listener, and proves a later startup remains audio-off. A second controlled case
reads the local interface list, selects an unassigned documentation IPv4 address,
and observes actual `EADDRNOTAVAIL` without changing any interface. These are source and
process checks, not a systemd/Tailscale reboot acceptance claim.

### Review the first peripheral service packet

`lib/peripherals/operator-service/` prepares the fixed EliteDesk operator packet.
Run `node --import tsx --test lib/peripherals/tests/operator-service.test.ts` for
owned temporary-file and simulated service-manager checks. The preparer emits
no activation command until an explicit jiggle object or `--disable-jiggle`
selection and the exact
reviewed installed web profile and independent source identities are supplied. It pins release/helper/Node/CLI
bytes and requires protected manager PATH/dirname resolution. The installer is
operator-only UID/GID1000; these tests neither activate a service nor open USB or
audio. A packet is not a remote delegation or a physical practice acceptance.


Verify disabled physical knob mode with the bridge unit/integration tests.
`jiggle:null` consumes valid motion sequence numbers but sends no configureJiggle
or knob commands; buttons, native light publication and cleanup still work.
The synthetic native-host fixtures cover attachment during playback, publication
gaps and reconnects without changing the audio lifecycle. Object configurations
retain their acknowledged threshold setup and ordered signed motion.

### Verify terse Sheets cues

Run `npm run verify:formal:cues` for the bounded actual-parser domain and six source mutation controls. Run `node --import tsx --test lib/performance/tests/sheet-cues.test.ts` for ingestion and archive-free canonical roundtrip. See [the language contract](implementation/sheet-cues.md) for current native capability boundaries; canonical import success does not mean native execution is supported.

### Verify native terse playback

Build WASM with `npm run build:wasm`, then run `node --import tsx --test lib/performance/tests/terse-wasm.test.ts lib/performance/tests/compiled-wasm.test.ts`. The fixtures use synthetic microphone PCM, explicit sustain regions, and supplied note order. They do not open devices or establish physical latency. Build `lib/performance` with CMake and run CTest for the native engine and patch checks. After covered native changes, run `npm run verify:formal:capture` with the pinned toolchain and inspect source mapping and mutation failures before updating its source record.

Tuning capture UI and native singing checks run with `node --import tsx --test ui/tuner/tests/panel-capture.test.ts lib/performance/tests/note-bank-capture.test.ts`. External assets and phone ingress use `lib/performance/tests/external-assets.test.ts`, `ui/practice/tests/phone-motion.test.ts` and `ui/practice/tests/phone-ui.test.ts`. These permission/event fixtures and real native/WASM PCM checks acquire no physical device. Full UI build verification includes the registered Tribulations XML and offline asset list. Do not start operator-managed CDP or a live practice session for these checks.


### Verify main-view effect rows

Run `node --import tsx --test ui/practice/tests/voice-effects.test.ts ui/practice/tests/voice-catalog.test.ts ui/practice/tests/audio-lifecycle.test.mjs`. After `npm run build:ui`, build the browser check with `node --import tsx scripts/build-voice-effects-check.ts --out-dir dist/fx-check`. Publish it with `./show-tools ui preview --session fx-check` and open `/fx-check/index.html` at the printed origin. The page checks real DOM draft edits, native acknowledgements, per-profile Apply, pending dry changes, remote stack management, exact saved decimals, invalid drafts and 390px overflow. Its final title must read `PASS: effect rows`.

In the actual practice desk, verify keyboard arrows adjust a focused knob without triggering Q/W/A/S or Space transport shortcuts. Verify Apply readback and reload persistence while stopped. Drag up/right to increase, down/left to decrease; Shift gives fine control. Keep the operator's active desk and audio session untouched. Main-view controls lock during practice; native DSP and the existing save/apply boundary own the effect change.

For the full Drunk Girls pickup/capture regression, run `node --import tsx scripts/verify-drunk-girls-performance.ts` after rebuilding WASM. It creates private temporary artifacts and executes the native host; it does not start a service or access devices. Inspect the canonical song with `./show-tools chart inspect songs/drunk-girls.musicxml`. Periodic live-source preparation and pickup-phase witnesses also run in `lib/performance/tests/terse-wasm.test.ts`.


### Verify identified hardware and browser inputs

Run `node --import tsx verification/physical-controls/verify.ts` for the source-fenced six-control and four-output finite domain, actual recording/playback feedback witnesses and eight actual-source mutation checks. See [its bounds](../verification/physical-controls/README.md) before interpreting the result. This command opens no hardware and does not establish installed readiness or spinner telemetry.

Run `node --import tsx --test lib/performance/tests/input-routing.test.ts` for canonical MusicXML bindings, strict installation/music separation and exact native routing readback. Build fresh WASM, then run `lib/performance/tests/physical-input-wasm.test.ts` and `ui/practice/tests/musical-input-policy.test.ts` through the same test command. The native `physical_input` target covers admitted and queued held ownership, failed admission, source-specific release, atomic replacement and producer fences.

Build the current fake host and set `NATIVE_FAKE_HOST` to its absolute executable before running `lib/peripherals/tests/bridge-integration.test.ts` and `lib/peripherals/tests/managed-runtime.test.ts`. Run `ui/practice/tests/browser-peripheral.test.ts` for stop, pagehide and policy changes during every attachment stage. These use owned synthetic processes and loopback sockets. They leave live services and devices untouched.

The [peripheral guide](../lib/peripherals/README.md#persistent-device-host) defines version-two installation profiles and explicit migration facts. Both adapters reject anonymous historical key defaults. Empty LED maps support input-only attachment without an output interface. Actual Linux CI must execute the multi-interface pipe fixtures; cross-compilation is insufficient. Physical acceptance still requires observed input maps and electrical confirmation. Source installer verification does not install or expand a host delegation.
