# Build cue-controlled slapback for native and WASM

Give performers a slapback patch they can attach to a sample channel through a song cue, the performance UI, or a peripheral.
Use one portable C++ implementation for EliteDesk and browser WASM.
Deliver P1 DSP, then P2 engine integration, then P3 controls and the recorded demo.
This is a proposal for review, not an implemented feature.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists.
Execute approved work using `poteto-mode/playbooks/autopilot-stack.md` from the installed skills directory.
The operator lands the stack. Do not merge into the operator's checkout automatically.
Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
The recommendations, source evidence, and product questions are in the appendices.
No live services run during planning. Future browser checks require an agreed local verification setup. Chromium and Sheets lifecycle remains operator-owned.

## Program checklist

### Arm the program

- [ ] Present this plan and its routing decisions, then stop. Begin implementation only after the operator's explicit go.
- [ ] Re-read `AGENTS.md`, `docs/architecture.md`, `docs/development.md`, and the updated `docs/workstreams.md` from the coordinator's checkout. The last file does not exist at this worktree's base.
- [ ] Inspect current contracts with `git show origin/main:lib/performance/include/performance_engine.h` when the remote ref is available. Record the actual integrated base SHA instead of assuming this command is current.
- [ ] Agree shared contracts with Performance Engine before editing any performance header, generated ABI, model, bridge, or compiled-song schema.
- [ ] For an approved unattended run, use `/loop 1h` only if scheduling is available and requested. Otherwise keep the implementation interactive. Post a status message on verified milestones or new blockers.

### Spawn owners

- [ ] Keep this workstream as the sole writer of patch DSP. Performance Engine owns command, song, clock, and performance ABI changes. EliteDesk owns device IO. Record owner acceptance in the integration milestone.
- [ ] Sequence P1 before P2 before P3. Coordinate P2 on the engine owner's agreed parent commit. Use independent worktrees for any delegated implementation.
- [ ] Stop at review-ready for all audible interaction changes. Do not start a service or publish a PR merely because this planning checklist names it.

### PR mechanics, for every PR

- [ ] Run the applicable verification below and inspect the final diff before committing each verified milestone.
- [ ] Apply deslop and technical-writing checks to each commit. Keep generated binaries, recordings, plots, and temporary PCM outside commits.
- [ ] When PR publication is requested, use the repository's available forge tooling and base each dependent PR on its parent. Record actual PR links here.

### Verdict and merge, for every PR

- [ ] Inspect rendered output and independent verification receipts at the exact head SHA. Recheck affected behavior after integration changes.
- [ ] Preserve the stack until the operator reviews and lands it. No automatic merges.

### Boot recipe, for every live lane

- [ ] Use a clean checkout at the named SHA. Run `npm ci`, `npm run build`, `npm run typecheck`, `npm test`, and `npm run check:layout` for integrated changes.
- [ ] Build native tests with `cmake -S lib/performance -B /tmp/show-tools-filters-native -DCMAKE_BUILD_TYPE=Release`, then `cmake --build /tmp/show-tools-filters-native` and `ctest --test-dir /tmp/show-tools-filters-native --output-on-failure`.
- [ ] Use the browser control skill for an agreed practice-page session with synthetic microphone input. A browser check never establishes physical audio-device behavior.
- [ ] Store receipts under `/tmp/show-tools-filters/<head>/<phase>/`. Save terminal or plot screenshots for native lanes and practice screenshots for browser lanes. Retain PCM, command logs, and timing data beside them.
- [ ] Run the ten scenarios sequentially where they share a device. Ten scenarios do not require ten competing audio hosts.

## Implement the prepared stereo delay (P1)

**Depends on.** None. Confirm routing and lifecycle recommendations before coding.

**Files.**

- [ ] Add portable DSP under proposed `lib/patches/` with a C++ header, source, CMake target, README, and deterministic PCM tests. Final filenames follow existing module conventions.

**Build.**

- [ ] Implement the bounded slapback definition and instance states from Appendix B. Prepare all delay memory before processing. Keep tests independent of devices and the performance ABI.
- [ ] Implement stereo delay, feedback, ramps, draining, flush, and bounded parameter updates. Preserve unity dry output and channel independence.

**You see.**

- [ ] Render an impulse with an exact 100 ms first echo and no echo on the other channel. Save PCM and an assertion report.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add native DSP tests for all Appendix C signal cases. Run the new module's documented CTest command with sanitizers in a separate build.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Render dry impulses on trunk and head. Record that trunk lacks slapback. Save `p1-dry.png`. Pass when dry PCM is unchanged and head adds the expected echo.
- [ ] Lane 2. Render a left impulse at 44,100 Hz. Save `p1-left.png`. Pass when the first echo is at frame 4,410.
- [ ] Lane 3. Render a right impulse at 48,000 Hz. Save `p1-right.png`. Pass when the first echo is at frame 4,800 and the left channel stays silent.
- [ ] Lane 4. Feed the same signal with block sizes 1, 127, 128, 511, and 1,024. Save `p1-blocks.png`. Pass when PCM agrees within 1e-6 absolute error.
- [ ] Lane 5. Bypass after an impulse. Save `p1-bypass.png`. Pass when old echoes drain and later input has no new echoes.
- [ ] Lane 6. Detach and reattach while draining. Save `p1-reattach.png`. Pass when one instance owns the tail and dry gain never doubles.
- [ ] Lane 7. Change delay on a steady signal. Save `p1-delay-change.png`. Pass when the read-head crossfade matches the independent reference envelope.
- [ ] Lane 8. Sweep feedback and wet across bounds. Save `p1-bounds.png`. Pass when output stays finite and rejected inputs preserve prior state.
- [ ] Lane 9. Flush at a nonzero delayed sample. Save `p1-flush.png`. Pass when all subsequent wet PCM is exactly zero.
- [ ] Lane 10. Listen to the rendered fixture through an approved playback setup. Save `p1-listen.png`. Pass when the expected single repeat is audible and attach has no audible click. Record listener and setup.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure callback time for identical dry rendering on baseline and head, plus standalone DSP time and allocations for four stereo instances at 48 kHz.
- [ ] Probe. Use an optimized build, warmed fixed input, and interleaved baseline/head runs. Record hardware, compiler, block size, callback count, percentiles, and worst duration.
- [ ] Baseline. Record baseline dry timing before head. Record that baseline lacks patch processing rather than reporting an effect speedup.
- [ ] Rule. Require zero process-time allocations, frees, locks, and IO. Proposed incremental p99 budget is 10% of a 128-frame audio period on the intended host. Confirm that budget on hardware before calling it realtime-ready.

**Review gate.** The operator reviews before merge.

- [ ] Present the impulse screenshot, an audio fixture, and a short video of playback controls to the operator. Record approval of audible defaults.

**Merge.**

- [ ] Commit verified DSP only. Record SHA and unresolved device limits. Leave landing to the operator.

## Integrate channel patches and cues (P2)

**Depends on.** P1 and the coordinated Performance Engine contract milestone.

**Files.**

- [ ] Edit sampler rendering and tests under `lib/sampler/`. Coordinate `lib/performance/` headers, source, model, bridge, and generated ABI with their owner.
- [ ] Update `docs/architecture.md`, `docs/development.md`, and module documentation alongside the verified route change.

**Build.**

- [ ] Sum voices per channel, run its patch, apply channel gain/mute and master gain, then add to sample output. Keep click outside the patch input.
- [ ] Preserve old dry accumulation when detached where practical. Explicitly test any rounding changes from per-channel summation.
- [ ] Execute patch cues at existing C++ segment boundaries. Commit resource replacement only while stopped after complete validation and preparation.
- [ ] Publish attachment, bypass, drain activity, parameters, revision, effective frame, and errors without allocating in the audio callback. Keep patch tail state separate from sample loop lights.

**You see.**

- [ ] Render a song fixture whose cue enables the next channel echo at its engine frame. Save native and WASM PCM plus applied-event receipts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend `lib/performance/tests/native_tests.cpp`, sampler native tests, and WASM integration tests. Run native CTest, `npm test`, `npm run build`, and typecheck.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Run existing capture, commit-and-autoplay, variants, and manual-hit fixtures on both builds. Save `p2-regression.png`. Pass when positions and dry playback remain equivalent.
- [ ] Lane 2. Attach through a song cue inside a block. Save `p2-cue.png`. Pass when the event frame and first affected sample match the declared rounded boundary.
- [ ] Lane 3. Send immediate UI-equivalent and peripheral-equivalent commands. Save `p2-controls.png`. Pass when both produce identical desired state and rendered output.
- [ ] Lane 4. Duplicate and reorder commands across a run change. Save `p2-order.png`. Pass when acknowledged retries do not retrigger attachment and stale commands fail explicitly.
- [ ] Lane 5. Record raw input while a wet sample plays. Save `p2-capture.png`. Pass when captured PCM equals the source microphone fixture exactly.
- [ ] Lane 6. Enable mandatory count-in click. Save `p2-click.png`. Pass when click PCM has no added echoes and patch tails do not feed capture.
- [ ] Lane 7. Mute a wet channel, then unmute. Save `p2-mute.png`. Pass when mute is silent while phase and delay time advance.
- [ ] Lane 8. Apply channel stop, global Stop, Panic, and reset separately. Save `p2-stop.png`. Pass when global silence has no stale tail on restart and channel stop follows Appendix B.
- [ ] Lane 9. Reject an unknown target and unsupported resource at song load. Save `p2-load.png`. Pass when the previous playable configuration remains intact.
- [ ] Lane 10. Compare native and WASM renders at both sample rates. Save `p2-conformance.png`. Pass when samples agree within 1e-6 absolute error and effective frames agree exactly.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure dry and maximum-wet `pf_process()` callback duration, allocation count, and bounded event-queue pressure on baseline and head.
- [ ] Probe. Interleave identical four-channel capture/playback runs on baseline and head. Use fixed song, PCM, voices, rate, and block size. Separately measure the added patch work.
- [ ] Baseline. Record dry baseline first and preserve its PCM digest and build identity. Do not compare different voice loads.
- [ ] Rule. Require zero callback allocations and bounded queues. Proposed p99 complete callback budget is 50% of the audio period, with zero deadline misses during the probe. Report host coverage and worst duration.

**Review gate.** The operator reviews before merge.

- [ ] Present a screenshot and video of the fixture timeline with audible cue attachment, detachment, and Stop to the operator.

**Merge.**

- [ ] Commit integration and documentation after the engine owner accepts contract compatibility. Record coordinated SHAs and regenerated ABI source. Leave landing to the operator.

## Demonstrate UI and peripheral control (P3)

**Depends on.** P2, Performance Engine UI coordination, and the EliteDesk simulated peripheral adapter.

**Files.**

- [ ] Let the Performance Engine owner integrate controls under `ui/practice/` and song-specific assignments under `songs/`. Supply DSP fixtures and tests from this workstream.
- [ ] Let EliteDesk own physical IO and host delivery. Update the practice contract with the shared command owner.

**Build.**

- [ ] Show explicit target, attached/bypassed state, wet amount, and delay. Map one simulated button to desired attachment and one knob to wet amount using the same semantic commands.
- [ ] Demonstrate a cue attaching a 100 ms slapback to a recorded loop, a knob changing wet, and a button detaching with a tail. Preserve relay-free local WASM commands.
- [ ] Keep the browser's recording-only live voice dry and centered. Record wet sample stereo and dry click through the existing output route.

**You see.**

- [ ] Produce a browser take with the requested slapback changes and decode the download to verify audible channel content. Label simulated peripherals explicitly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend practice lifecycle, voice-recording, worklet, and compiled-song tests. Run `npm run typecheck`, `npm test`, `npm run check:layout`, and `npm run build`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Perform the same synthetic-microphone take on trunk and head. Save `p3-take.png`. Pass when capture and download complete and head adds the intended sample echo.
- [ ] Lane 2. Run local WASM without a relay or Sheets helper. Save `p3-local.png`. Pass when UI and cues control the patch throughout a take.
- [ ] Lane 3. Use a narrow viewport. Save `p3-mobile.png`. Pass when target, pending state, controls, and errors are readable and usable.
- [ ] Lane 4. Turn the simulated knob while playback runs. Save `p3-knob.png`. Pass when accepted values match native state without transport interruption.
- [ ] Lane 5. Reconnect the simulated controller. Save `p3-reconnect.png`. Pass when it recovers a snapshot without toggling attachment unexpectedly.
- [ ] Lane 6. Detach during audible feedback. Save `p3-tail.png`. Pass when the dry path stays at unity and the tail drains once.
- [ ] Lane 7. Stop during capture, restart, and Panic. Save `p3-panic.png`. Pass when no old echo returns and a completed download remains accessible.
- [ ] Lane 8. Decode the downloaded take. Save `p3-download.png`. Pass when sample stereo remains wet and live voice remains centered and dry without duplicate microphone gain.
- [ ] Lane 9. Switch songs while stopped and reject an unsupported patch definition. Save `p3-song.png`. Pass when no old attachment leaks and the rejected load preserves prior configuration.
- [ ] Lane 10. Run the native host simulation through identical cue/control logs. Save `p3-native.png`. Pass when effective engine frames and state match WASM. Record physical-device testing separately.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure command delivery-to-application delay, native effective frames, event drops, and complete callback duration on baseline and head. Separate UI receipt latency from audio time.
- [ ] Probe. Interleave dry and patched takes with identical synthetic input and a bounded 100-updates-per-second simulated controller burst. Capture native receipts and browser diagnostics.
- [ ] Baseline. Record baseline callback timing and ordinary channel-control delivery before head. Record patch delivery as new behavior with its own absolute budget.
- [ ] Rule. Require no render-thread waiting on UI/network, no unbounded queue growth, and next-block application after engine acceptance for immediate commands. Preserve P2 audio budgets. Report browser latency without calling receipt time sample-accurate.

**Review gate.** The operator reviews before merge.

- [ ] Present desktop and narrow screenshots, a 30 to 60 second demo video, and the decoded take to the operator. Record approval of routing and tail behavior.

**Merge.**

- [ ] Commit verified cross-owner changes in coordinated order. Report simulated versus physical coverage. Leave landing to the operator.

## Close the program

- [ ] Record every implementation SHA, command result, PCM comparison, and review receipt. Leave unperformed checks unchecked.
- [ ] Deliver the reviewed stack and name remaining microphone, mobile, and EliteDesk device checks explicitly.

## Appendix A. Prototype evidence

Planning inspected source at `619df0393c2a4fc357e4a2451b8e14e41d7421d4`. No sound prototype or benchmark ran. Sound preferences remain proposals.

- `lib/performance/src/performance_engine.cpp:205` captures microphone PCM before rendering. Click adds directly to outputs at line 218, followed by sampler output at line 229.
- `lib/sampler/src/sample_engine.cpp:304` renders individual voices directly into final buffers. Line 315 applies channel gain/mute per voice. Per-channel patch input does not exist yet.
- `lib/performance/src/performance_engine.cpp:530` splits audio at beat crossings, using the ceiling of the event frame for discrete samples. Patch cues must use this existing timing rule.
- `lib/performance/src/performance_engine.cpp:116` centralizes silence. `pf_stop()` at line 377 and epoch reset at line 247 reach that path.
- `ui/practice/audio.ts:66` sends worklet output to demo recording. Lines 97 through 110 build a separate microphone branch, downmix it to mono, and send it directly to recording.
- `lib/performance/README.md` documents single-thread engine ownership, command deduplication, stopped configuration, fixed WASM memory, and native build commands.

The route findings came from direct source inspection and a separate read-only explorer. No services started. No empirical sound claims are made. P1 contains the rendered sketches that compare ramps and delay updates before production integration.

## Appendix B. Define the patch and its contracts

### Choose the first routing graph

Recommended graph for each selected sample channel is voice summation, slapback, channel gain/mute, master gain, then stereo sample summation. Click joins only after the patch input is complete. The current click-first accumulation may remain if the patch never reads final output buffers.

Captured PCM stays raw. Sample playback receives the patch. Downloads receive wet sample output and dry click through the existing worklet route. Live voice remains dry in its recording-only mono branch. Live microphone speaker monitoring remains absent.

Use one slot per existing sample channel, at most four instances. A definition identifies slapback and validated defaults. An instance identifies one target channel and its current state. Do not implement arbitrary graphs, sends, effect reordering, or cross-channel feedback in this demo.

### Prepare bounded stereo DSP

Proposed defaults are 100 ms delay, zero feedback, 0.25 wet, and unity dry. Delay range is 40 to 250 ms. Feedback range is 0 to 0.7. Wet range is 0 to 1. Parameters must be finite. Reject unsupported values atomically instead of silently clamping them.

For settled parameters, compute delayed sample d[n] from the ring, write x[n] + feedback * d[n], and output x[n] + wet * d[n]. Keep left and right rings independent. Mono sample playback feeds both equally. Never downmix stereo samples or feed click into the rings.

At integer delays with a unit impulse, expected echoes are wet at D, wet times feedback at 2D, and wet times feedback squared at 3D. Choose D as delay seconds times sample rate, with fractional linear interpolation for noninteger positions. The 100 ms fixture has exact integer positions at both tested rates.

Use 5 ms linear ramps for input send and wet attachment. Smooth wet and feedback updates over 5 ms. Change delay by crossfading old and new read taps over 20 ms instead of abruptly moving a read head. Use the convex blended delayed value for feedback. Coalesce rapid updates into a bounded latest desired value; verify the final settled value and audible transition before selecting this scheme.

Prepare rings for the maximum delay plus interpolation guards and bounded render scratch outside processing. Four stereo float rings at 48 kHz need about 384 KB before scratch and metadata, calculated as 4 * 2 * 12,000 * 4 bytes. Enforce a supported sample-rate range and compute the actual capacity at preparation. Sample-rate changes require stopped re-preparation. No dependency is proposed. Preserve repository licensing for new source.

### Apply explicit lifecycle states

Use detached, active, bypassed, and draining states, with desired state and current transition recorded separately. A bypassed instance remains attached. A detached instance retains only its prepared slot and definition.

- Attach from detached clears history and ramps the send and wet gain. Reattaching the same draining instance resumes its existing ring with a ramp, without adding a second dry path.
- Soft bypass ramps new input send to zero, leaves the existing tail audible, and retains the instance for later enable. Detach does the same but becomes detached when the tail ends.
- Detect drain completion from bounded ring energy, not one silent output sample. Silence below 1e-6 absolute amplitude may end a tail. Bound draining to 12 seconds with a final 5 ms fade. Confirm threshold and timeout during P1 listening.
- Channel mute and gain apply after the patch, including its tail. Continue advancing rings during mute. Unmute may reveal the currently decayed tail, while loop phase remains intact.
- A channel stop cue stops feeding its sample and lets the tail drain. Global Stop and Panic immediately silence and clear all patch history, preserving the existing global silence promise. A hard cut can click and is deliberate for emergency silence.
- Global Stop preserves patch definitions and desired settings while stopped. Start reinitializes history and applies the compiled song's initial attachments, clearing manual overrides. Panic also clears manual overrides and detaches instances. Confirm these distinctions with Performance Engine.
- Reset, engine disposal, song replacement, and clock discontinuity clear history and attachment state. Failed replacement preserves the prior complete configuration. Successful replacement installs the new song's initial state only at the agreed lifecycle boundary.
- A normal loop wrap retains attachment and tails. Repeated attach cues are idempotent. A cue may explicitly detach or reset if the arrangement needs silence at a loop edge.

### Submit semantic requirements to Performance Engine

The owner proposed versioned semantic JSON independent of the performance binary ABI. Accept that separation. Use stable song, resource, cue, instance, and target IDs plus a program digest. Song assignments stay under `songs/`.

Example semantic intent is resource `slapback-short`, instance `R1-slap`, target sample channel `R1`, and operation attach at the cue's declared engine timing. A later cue detaches that same instance. This example is a schema requirement, not a new parser syntax or an approved binary layout.

Require attach, detach, explicit bypass boolean, and atomic parameter updates. Use desired states rather than toggles. An invalid target, unknown resource, unsupported operation, nonfinite parameter, or exhausted slot fails explicitly. Reject unsupported patch capability at compile/load, before starting playback.

Use the owner's command envelope with producerId, commandId, producerSequence, runId, expected programDigest, target, action, and timing. Honor existing identity encoding and bounded deduplication. Do not promise persistent exactly-once delivery. Order accepted changes on the engine-owning thread. Reject stale runs and program revisions. Define overflow and late policies explicitly in the coordinated contract.

Resolve immediate commands at the next process boundary after engine acceptance. Resolve beat and bar commands in C++ using the existing transport. External arrival time never becomes a clock. For future-frame commands, split blocks at their accepted effective frame. Report rejection or explicit late application rather than backdating a state change.

Publish engineSessionId, runId, epoch, programDigest, sourceSequence, effective frame, sampleRate, command identity, applied revision, and result. Patch state includes target, attachment, bypass, desired/effective parameters, and tail activity. Preserve dropped-event counts and snapshot recovery. Keep tail activity distinct from channel looping and cue-light state.

Validate and prepare every patch definition and reference while stopped before swapping song state. Require atomic song/resource replacement and no allocation at the cue. Performance Engine owns any header changes, ABI version increase, and generated bridge updates. Filters supplies DSP interfaces and conformance fixtures. EliteDesk maps peripheral inputs to these commands without owning musical timing.

### Ask the operator only for sound and workflow choices

1. Should the first demo affect recorded sample playback only, as recommended, or must live voice also have slapback? Wet live voice requires a separate recording-only C++ output and coordinated browser/native routing. It must not introduce accidental microphone monitoring or double the dry voice.
2. Does the proposed 100 ms single-repeat default fit the desired sound? Recommend starting there and auditioning wet amount before adding filtering, saturation, tempo sync, or ping-pong.
3. Should channel stop and detach let the echo finish, as recommended, while global Stop and Panic cut immediately? Also confirm that Start restores song defaults rather than keeping manual patch overrides from the prior run.

## Appendix C. Record risks and alternatives

A master-output delay is smaller but includes click and cannot target a pad. A sample-mix delay preserves click only with a separate bus, but loses per-channel attachment. A capture effect permanently alters stored takes. Browser DelayNode DSP duplicates native behavior. Reject these for the first demo.

Additive wet gain can exceed full scale. Preserve the current engine's float mix behavior and test peak levels. Use a quiet audition fixture and confirm headroom during listening. Do not silently insert a limiter or normalize the dry path.

Channel summation changes float addition order. Require dry fixture equivalence within 1e-6 where bit equality is unavailable. Keep unaffected capture PCM bit-identical. Output pointers may be mono or null; test both using the current sampler contract.

DSP unit tests must include impulse position/amplitude, feedback decay, stereo isolation, fractional delay, silence, long drain, repeated attach, wet zero, parameter rejection, maximum capacity, varied blocks, and flush. Integration tests must cover capture boundaries, variants, manual taps, click exclusion, gain/mute, Stop/Panic/reset, loop wrap, atomic load failure, stale commands, and native/WASM agreement.

Allocation tracing and sanitizer tests establish narrower facts than physical realtime performance. Hardware callback budgets are proposed acceptance targets. No latency, underrun, acoustic quality, mobile browser, or EliteDesk device result has been measured in this plan.

Throughput checkpoint after P1 is a deterministic PCM renderer shared by native and WASM fixtures. Reuse its signals and command logs in P2 and P3. Stop if later verification depends only on state snapshots or if contract coordination creates two independent command models.

## Appendix D. Links and reading list

Read [architecture](../architecture.md), [development](../development.md), the [performance contract](../../ui/practice/CONTRACT.md), [native performance guide](../../lib/performance/README.md), and [sampler guide](../../lib/sampler/README.md).
The superseding `docs/workstreams.md` currently lives in the coordinator's checkout. Reconcile it and the sibling plans at the integration base before implementation.
Installed planning skills are `/Users/anulman/.codex/skills/poteto-mode/`, `how/`, `technical-writing/`, `unslop/`, and `deslop/`.
Separate Before Serializing Shared State shaped the single-writer contract ownership and isolated checkout. Test Behavior, Not Implementation shaped PCM assertions and decoded-download checks instead of relying on attachment flags.
