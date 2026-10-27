# Build cue-controlled slapback for native and WASM

Give performers ordered effects stacks per voice, controlled by song cues, the performance UI, and peripherals.
Apply the voice stack to live voice, sampled voice, and downloads. Slapback is the first implemented effect.
Use one portable C++ implementation for EliteDesk and browser WASM.
Deliver P1 DSP, then P2 engine integration, then P3 controls and the recorded demo.
This is a proposal for review, not an implemented feature.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists.
Execute approved work using `poteto-mode/playbooks/autopilot-stack.md` from the installed skills directory.
The operator lands the stack. Do not merge into the operator's checkout automatically.
Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
The operator decisions, routing recommendations, source evidence, and remaining product questions are in the appendices.
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

- [ ] Implement the bounded slapback definition, ordered stack representation, and instance states from Appendix B. Prepare all delay and stack-transition memory before processing. Keep tests independent of devices and the performance ABI.
- [ ] Implement stereo delay, feedback, ramps, draining, flush, and bounded parameter updates. Preserve unity dry output and channel independence. Give each live or sampled signal path its own mutable DSP state.

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
- [ ] Lane 6. Detach a stage from a two-stage stack, then reattach while draining. Save `p1-reattach.png`. Pass when stage order remains explicit, each tail has one owner, and dry gain never doubles.
- [ ] Lane 7. Change delay on a steady signal. Save `p1-delay-change.png`. Pass when the read-head crossfade matches the independent reference envelope.
- [ ] Lane 8. Sweep feedback and wet across bounds. Save `p1-bounds.png`. Pass when output stays finite and rejected inputs preserve prior state.
- [ ] Lane 9. Flush at a nonzero delayed sample. Save `p1-flush.png`. Pass when all subsequent wet PCM is exactly zero.
- [ ] Lane 10. Listen to the rendered fixture through an approved playback setup. Save `p1-listen.png`. Pass when the expected single repeat is audible and attach has no audible click. Record listener and setup.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure callback time for identical dry rendering on baseline and head, plus standalone DSP time and allocations at the admitted maximum stack/path capacity at 48 kHz.
- [ ] Probe. Use an optimized build, warmed fixed input, and interleaved baseline/head runs. Record hardware, compiler, block size, callback count, percentiles, and worst duration.
- [ ] Baseline. Record baseline dry timing before head. Record that baseline lacks patch processing rather than reporting an effect speedup.
- [ ] Rule. Require zero process-time allocations, frees, locks, and IO. Proposed incremental p99 budget is 10% of a 128-frame audio period on the intended host. Confirm that budget on hardware before calling it realtime-ready.

**Review gate.** The operator reviews before merge.

- [ ] Present the impulse screenshot, an audio fixture, and a short video of playback controls to the operator. Record approval of audible defaults.

**Merge.**

- [ ] Commit verified DSP only. Record SHA and unresolved device limits. Leave landing to the operator.

## Integrate voice stacks and capture routing (P2)

**Depends on.** P1, the coordinated Performance Engine contract milestone, and operator acceptance of the raw-storage recommendation. If printed wet takes are chosen instead, revise the capture and exactly-once-processing fixtures before P2 starts.

**Files.**

- [ ] Edit sampler rendering and tests under `lib/sampler/`. Coordinate `lib/performance/` headers, source, model, bridge, generated ABI, and browser audio output routing with Performance Engine.
- [ ] Update `docs/architecture.md`, `docs/development.md`, and module documentation alongside the verified route change.

**Build.**

- [ ] Sum sample playbacks belonging to a logical voice, run its ordered stack, apply voice gain/mute and master gain, then sum outputs. Keep click outside every voice stack. Process live microphone through the default or capture-target voice stack in C++ as Appendix B specifies.
- [ ] Replace the browser dry-microphone recording bypass with explicit processed-live and processed-sample output routing. Mix live voice exactly once into each selected destination. Preserve stereo samples and existing centered mono voice unless a configured effect intentionally widens it.
- [ ] Execute patch cues at existing C++ segment boundaries. Commit resource replacement only while stopped after complete validation and preparation.
- [ ] Publish logical voice, stack revision/order, capture route, effect instance, bypass, drain activity, resolved parameters, and effective frame without callback allocation. Keep tail state separate from sample loop lights.
- [ ] Audit capture arm and commit preparation alongside stack preparation. Current `arm()` reaches `st_prepare()` before dispatch, so a command being native does not establish callback safety.
- [ ] Add bounded observer delivery and DEBUG/INFO/WARN host logging. Keep PCM artifacts debug-only and all formatting, serialization, and IO off the realtime thread.

**You see.**

- [ ] Render a song fixture whose capture entry selects the voice stack and whose exit restores the default live stack. Save live, sample, and download PCM from native and WASM plus applied-event receipts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend `lib/performance/tests/native_tests.cpp`, sampler native tests, and WASM integration tests. Run native CTest, `npm test`, `npm run build`, and typecheck.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Run existing capture, commit-and-autoplay, variants, and manual-hit fixtures on both builds. Save `p2-regression.png`. Pass when positions and dry playback remain equivalent.
- [ ] Lane 2. Enter and exit voice capture inside a block, including a fractional-beat cue. Save `p2-cue.png`. Pass when live routing, capture boundary, and first affected sample match the declared engine frame.
- [ ] Lane 3. Send immediate UI-equivalent and peripheral-equivalent commands. Save `p2-controls.png`. Pass when both produce identical desired state and rendered output.
- [ ] Lane 4. Duplicate and reorder commands across a run change. Save `p2-order.png`. Pass when acknowledged retries do not retrigger a stack transition, stale commands fail explicitly, and active program state stays immutable.
- [ ] Lane 5. Record raw input through one voice stack and replay through that stack while live voice uses default effects. Save `p2-capture.png`. Pass when stored PCM equals source and both live and sample paths receive exactly one intended processing pass.
- [ ] Lane 6. Enable mandatory count-in click. Save `p2-click.png`. Pass when click PCM has no added echoes and patch tails do not feed capture.
- [ ] Lane 7. Resolve voice defaults plus per-effect overrides in a two-stage ordered stack. Mute and unmute its output. Save `p2-mute.png`. Pass when precedence and order match the fixture and mute is silent while state advances.
- [ ] Lane 8. Apply channel stop, global Stop, Panic, and reset separately. Save `p2-stop.png`. Pass when global silence has no stale tail on restart and channel stop follows Appendix B.
- [ ] Lane 9. Reject an unknown target and unsupported resource at song load. Save `p2-load.png`. Pass when the previous playable configuration remains intact.
- [ ] Lane 10. Compare native and WASM live/sample/download stems at both rates under DEBUG, practice INFO, and performance WARN. Save `p2-conformance.png`. Pass when PCM agrees within 1e-6, frames agree exactly, logs obey thresholds, and required control acknowledgments survive every log level.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure dry and maximum-wet `pf_process()` callback duration, allocation count, and bounded event-queue pressure on baseline and head.
- [ ] Probe. Interleave identical capture/playback runs on baseline and head. Use fixed song, PCM, voices, rate, and block size. Separately measure maximum admitted stack/path work, route transitions, and DEBUG observer pressure.
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

- [ ] Show the logical voice, ordered stack, voice defaults, and per-effect overrides. Map a simulated button to desired attachment and a knob to a parameter or declared voice-trigger operation using the same semantic commands.
- [ ] Demonstrate live voice through default slapback, capture entry selecting a voice stack, sampled playback through that voice stack, and exit restoring the default live stack. Change wet by knob and detach by button. Preserve relay-free local WASM commands.
- [ ] Record processed live voice and processed sample stereo plus dry click. Remove the old dry microphone recording bypass. Verify that the same voice settings reach native, browser monitoring, and downloads through explicit destination routing.

**You see.**

- [ ] Produce a browser take with the requested slapback changes and decode the download to verify audible channel content. Label simulated peripherals explicitly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend practice lifecycle, voice-recording, worklet, and compiled-song tests. Run `npm run typecheck`, `npm test`, `npm run check:layout`, and `npm run build`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Perform the same synthetic-microphone take on trunk and head. Save `p3-take.png`. Pass when capture and download complete and head adds the intended live and sample effects. Record the intentional live-route change.
- [ ] Lane 2. Run local WASM without a relay or Sheets helper. Save `p3-local.png`. Pass when UI and cues control the patch throughout a take.
- [ ] Lane 3. Use a narrow viewport. Save `p3-mobile.png`. Pass when target, pending state, controls, and errors are readable and usable.
- [ ] Lane 4. Turn the simulated knob during capture transitions and playback. Save `p3-knob.png`. Pass when parameters match native state without interruption and declared chorus-voice triggers are bounded or fail explicitly if unsupported.
- [ ] Lane 5. Reconnect the simulated controller. Save `p3-reconnect.png`. Pass when it recovers a snapshot without toggling attachment unexpectedly.
- [ ] Lane 6. Detach during audible feedback. Save `p3-tail.png`. Pass when the dry path stays at unity and the tail drains once.
- [ ] Lane 7. Stop during capture, restart, and Panic. Save `p3-panic.png`. Pass when no old echo returns and a completed download remains accessible.
- [ ] Lane 8. Decode the downloaded take. Save `p3-download.png`. Pass when live and sampled voice receive their resolved stacks, stereo samples stay intact, click stays dry, and the microphone appears exactly once.
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

Planning inspected source at `619df0393c2a4fc357e4a2451b8e14e41d7421d4`. No sound prototype or benchmark ran. Source observations below describe the current implementation, which the revised graph replaces.

Operator decisions read directly through the GitHub API on October 27, 2026 supersede the initial sample-only proposal. [Per-voice stacks](https://github.com/anulman/show-tools/pull/1#discussion_r4384882009) require voice-wide and effect/voice settings, capture-time default/voice stack switching, and dial-triggered effects such as chorus voices. [All voice paths](https://github.com/anulman/show-tools/pull/1#discussion_r4384940894) must receive patches, including live voice and downloads. [Logging thresholds](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380) apply engine-wide.

- `lib/performance/src/performance_engine.cpp:205` captures microphone PCM before rendering. Click adds directly to outputs at line 218, followed by sampler output at line 229.
- `lib/sampler/src/sample_engine.cpp:304` renders individual voices directly into final buffers. Line 315 applies channel gain/mute per voice. Per-channel patch input does not exist yet.
- `lib/performance/src/performance_engine.cpp:530` splits audio at beat crossings, using the ceiling of the event frame for discrete samples. Patch cues must use this existing timing rule.
- `lib/performance/src/performance_engine.cpp:116` centralizes silence. `pf_stop()` at line 377 and epoch reset at line 247 reach that path.
- `ui/practice/audio.ts:66` sends worklet output to demo recording. Lines 97 through 110 build a separate microphone branch, downmix it to mono, and send it directly to recording.
- `lib/performance/README.md` documents single-thread engine ownership, command deduplication, stopped configuration, fixed WASM memory, and native build commands.

The route findings came from direct source inspection and a separate read-only explorer. No services started. No empirical sound claims are made. P1 contains the rendered sketches that compare ramps and delay updates before production integration.

## Appendix B. Define the patch and its contracts

### Apply the operator's per-voice routing

A logical voice is a performer-facing part, such as the cowbell, not an individual sampler playback allocation. Give each logical voice a stable ID, voice-wide defaults, and an ordered effects stack. Resolve effect-type defaults first, compatible voice-wide defaults second, and that effect/voice pair's explicit overrides last. Validate each typed parameter against its effect. Voice gain and mute apply after the complete stack. Do not share mutable delay state between logical voices or between live and sampled signals.

For sampled sound, sum playbacks belonging to the logical voice, process its ordered stack, then apply voice gain/mute and master gain. Preserve independently recorded variants and layering. A chorus-triggered child voice is an explicit bounded engine voice operation with an assigned stack and output target, not a JavaScript scheduler or an accidental copy of live microphone audio.

For live microphone, process the default live stack outside capture. At the native capture-entry boundary, select the corresponding logical voice's stack. At capture exit, restore the default live stack. Capture the source before effects as a proposed storage policy. Save voice/stack identity with the take and apply the resolved voice stack exactly once on sample playback. Raw storage does not make live output dry. It avoids stacking the captured effect again on replay. Decide whether a take pins a stack revision or follows subsequent voice edits before implementation; recommend following voice edits while retaining capture provenance.

Prepare separate live and sample state for each admitted stack. The live input has one routing owner per frame. If multiple captures overlap, the compiled route must name the live processing target explicitly. Reject ambiguous route ownership during load rather than doubling the live microphone across every recording voice. Multiple raw captures may still proceed if the engine supports them. Coordinate capture-start failures, commit-and-arm, stop, cancellation, and capture limits so every successful exit restores the correct live route.

For the unity-dry slapback demo, keep one common dry input and separate each chain's wet contribution. Ramp old live input send down and new send up over 5 ms. Drain the old chain with zero input and retain its wet contribution continuously while ramping the new wet contribution up. Do not crossfade the old tail to zero and then add it back at full gain. Prototype the transition with sustained input and impulses to select the exact wet envelopes before integration. Define consecutive transitions and capacity rejection before the first fade completes. Preparation must reserve transition state; a capture cue cannot allocate it. Future effects that change the dry path need an explicit full-output transition policy and cannot assume this unity-dry decomposition.

Provide separate C++ output stems or an equally explicit destination matrix for processed live voice, processed samples, and click. Route those same processed stems to native outputs, browser outputs, and recording downloads. Remove `syncRecordingVoice()`'s dry microphone bypass when that route lands. Keep one dry component within each processed voice signal and never add another direct microphone branch to the download.

The operator requires wet live voice. The choice of which physical or browser output monitors it remains a destination policy to confirm, especially for speaker versus headphone use. The engine must provide the processed live stem even if a host disables monitoring. Monitoring selection cannot change the recorded processing or secretly bypass the stack. Click stays outside all voice effects and never feeds sample capture.

Use a bounded ordered list per voice, with proposed capacity four stages, nine primary processing paths, and two retired-chain slots. The nine primary paths cover the existing four sample parts plus default and per-part live states. Allocate every primary path and both retirement slots before activation. Capture entry and exit switch sends among dedicated live paths and may resume that same voice's decaying history; they never need a retirement slot. Reserve retirement slots for graph edits. Reject an edit before mutation when both slots are occupied, while capture continues unchanged. A route switch must not fail because prior edits consumed tail capacity. This is an admission-budget proposal, not a new four-voice product limit. Confirm actual voice and chorus capacity with Performance Engine. Validate the full graph before activation. Arbitrary cycles and cross-voice feedback are outside this first demo, but ordered multiple effects per voice are required now. Slapback supplies the first DSP type; two differently configured slapback stages prove composition without pretending chorus DSP already exists.

### Prepare bounded stereo DSP

Proposed defaults are 100 ms delay, zero feedback, 0.25 wet, and unity dry. Delay range is 40 to 250 ms. Feedback range is 0 to 0.7. Wet range is 0 to 1. Parameters must be finite. Reject unsupported values atomically instead of silently clamping them.

For settled parameters, compute delayed sample d[n] from the ring, write x[n] + feedback * d[n], and output x[n] + wet * d[n]. Keep left and right rings independent. Mono sample playback feeds both equally. Never downmix stereo samples or feed click into the rings.

At integer delays with a unit impulse, expected echoes are wet at D, wet times feedback at 2D, and wet times feedback squared at 3D. Choose D as delay seconds times sample rate, with fractional linear interpolation for noninteger positions. The 100 ms fixture has exact integer positions at both tested rates.

Use 5 ms linear ramps for input send and wet attachment. Smooth wet and feedback updates over 5 ms. Change delay by crossfading old and new read taps over 20 ms instead of abruptly moving a read head. Use the convex blended delayed value for feedback. Coalesce rapid updates into a bounded latest desired value; verify the final settled value and audible transition before selecting this scheme.

Prepare rings for the maximum delay plus interpolation guards and bounded render scratch outside processing. At the proposed eleven total chain slots and four slapback stages per slot, stereo float rings at 48 kHz need about 4.224 MB before scratch, interpolation guards, chorus branches, and metadata, calculated as 11 * 4 * 2 * 12,000 * 4 bytes. Live send transitions use those dedicated primary states and bounded scratch. Retired graph versions use the two reserved chain slots. Reject configurations above prepared capacity and report the admitted limits. Include pending tails and transitions in admission accounting. Enforce a supported sample-rate range and compute the actual capacity at preparation. Sample-rate changes require stopped re-preparation. No dependency is proposed. Preserve repository licensing for new source.

### Apply explicit lifecycle states

Use detached, active, bypassed, and draining states per effect instance, with desired state and current transition recorded separately. Track the active live route and stack transition independently. A bypassed instance remains attached. A detached instance retains only its prepared slot and definition.

- Attach from detached clears history and ramps the send and wet gain. Reattaching an unchanged standalone draining instance resumes its existing ring with a ramp. For stack edits, reuse a draining chain only when its graph and parameter revision still match. Otherwise use a prepared replacement chain and retire the old tail. Never render shared mutable stage state twice or add a second dry path.
- Soft bypass ramps new input send to zero, leaves the existing tail audible, and retains the instance for later enable. Detach does the same but becomes detached when the tail ends. Within a serial stack, retain a prepared old chain to drain its wet-only contribution and use the same common-dry transition policy for the new chain. Stable stage IDs do not imply shared mutable state between old and new chain renders. Count retained chains against capacity and reject excess edits explicitly. Do not move a delayed signal around downstream effects without defining its route.
- Detect drain completion from bounded ring energy, not one silent output sample. Silence below 1e-6 absolute amplitude may end a tail. Bound draining to 12 seconds with a final 5 ms fade. Confirm threshold and timeout during P1 listening.
- Voice mute and gain apply after the stack, including its tails. Continue advancing rings during mute. Unmute may reveal the currently decayed tail, while loop phase remains intact.
- A voice stop cue stops feeding its sample stack and lets its tails drain. If the voice owns the live capture route, ending that capture also restores the default live route. Global Stop and Panic immediately silence and clear all patch history, preserving the existing global silence promise. A hard cut can click and is deliberate for emergency silence.
- Every capture exit, including failure, Stop, Panic, and capacity limit, releases its live route and restores the default route or the stopped state. Global Stop/Panic gate incoming live processing and every audible voice output as well as clearing history. Reopening the microphone cannot regenerate echoes until explicit Start or a separately authorized monitoring lifecycle boundary. Normal capture exit during a running take restores the default live route without that global gate. Global Stop preserves patch definitions and desired settings while stopped. Start reinitializes history and applies the compiled song's initial attachments, clearing manual overrides. Panic also clears manual overrides and detaches instances. Confirm these distinctions with Performance Engine.
- Reset, engine disposal, song replacement, and clock discontinuity clear history and attachment state. Failed replacement preserves the prior complete configuration. Successful replacement installs the new song's initial state only at the agreed lifecycle boundary.
- A normal loop wrap retains attachment and tails. Repeated attach cues are idempotent. A cue may explicitly detach or reset if the arrangement needs silence at a loop edge.

### Submit semantic requirements to Performance Engine

The owner proposed versioned semantic JSON independent of the performance binary ABI. Accept that separation. Use stable song, resource, cue, instance, and target IDs plus a program digest. Song assignments stay under `songs/`.

Example semantic intent is logical voice `R1`, stack `R1-effects`, stage instance `R1-slap`, resource `slapback-short`, and an attach operation at the cue's declared engine timing. A later cue detaches that same stage. Capture entry selects the voice's stack for live processing, and exit restores `default-live-effects`. The same voice stack configures independent sample processing state. This example is a schema requirement, not a new parser syntax or an approved binary layout.

Require ordered stack assignment, attach, detach, explicit bypass boolean, voice-default edits, per-effect/voice overrides, and atomic parameter updates. Identify stack revision, stage order, logical voice, and signal path separately. Allow a dial mapping to emit a typed, bounded voice-spawn operation such as chorus; admit it only when its DSP and resources exist. Performance Engine reports current DYC knob tokens `[4d-,d,-1d],-3d]` and `[4d-`, plus an A17 chorus/video note. Treat these as unresolved semantic requests for the compiler and DSP owners, not an existing chorus capability or a DSP-side parser grammar. Use desired states rather than toggles. An invalid target, unknown resource, unsupported operation, nonfinite parameter, or exhausted slot fails explicitly. Reject unsupported patch capability at compile/load, before starting playback.

Use the owner's revised command envelope with producerId, commandId, producerSequence, runId, target, action, and timing. Honor existing identity encoding and bounded deduplication. Do not promise persistent exactly-once delivery. Freeze the active compiled program for the run, so its digest cannot change during playback. Validate replacement only while stopped instead of adding per-block stale-digest recovery. Reject old-run commands at the host boundary. Define overflow and late policies in the coordinated contract.

Resolve immediate peripheral commands at the next process boundary after engine acceptance. Resolve cue timing, including quarter-, half-, and three-quarter-beat offsets, in C++ using the shared transport and actual measure length. External arrival time never becomes a clock. For future-frame commands, split blocks at their accepted effective frame. Report rejection or explicit late application rather than backdating a state change.

Publish engineSessionId, runId, epoch, programDigest, sourceSequence, effective frame, sampleRate, command identity, applied revision, and result. Patch state includes logical voice, stack revision and stage order, current live route, per-path instance identity, attachment, bypass, resolved parameters and their override sources, and tail activity. Preserve dropped-event counts and snapshot recovery. Keep tail activity distinct from channel looping and cue-light state.

Validate and prepare every patch definition and reference while stopped before swapping song state. Require atomic song/resource replacement and no allocation at the cue. Include the current capture `arm()` call to `st_prepare()` in the preparation audit, not just new DSP memory. Performance Engine owns any header changes, ABI version increase, and generated bridge updates. Filters supplies DSP interfaces and conformance fixtures. EliteDesk maps peripheral inputs to these commands without owning musical timing.

### Keep logs outside processing

The operator set DEBUG verbosity for debug runs with rich artifacts, INFO for actual practice, and WARN for performance. Apply this policy engine-wide, not just in effects code. Serialize and write logs, PCM exports, and plots outside the realtime path. Use bounded preallocated debug traces and copied observer records with overflow counters. Disable rich PCM capture outside explicit debug runs. Never make cue dispatch, processing, acknowledgments, or correctness state depend on diagnostic verbosity.

### Confirm only unresolved sound and destination choices

1. Which outputs monitor the processed live voice by default in browser practice and on EliteDesk? All downloads must include its voice stack regardless of monitoring choice. Recommend explicit host monitoring selection with a single processed recording route.
2. Does the proposed 100 ms single-repeat default fit the desired sound? Recommend starting there and auditioning wet amount before adding further DSP types. Multiple ordered stages are part of the initial stack model.
3. Should channel stop and detach let echoes finish while global Stop and Panic cut immediately? Recommend that behavior and restoring song defaults at Start. Voice/live/download coverage and per-voice stack switching are already settled requirements.

## Appendix C. Record risks and alternatives

A master-output delay includes click and cannot select a voice. A sample-only effect omits the required live voice. A single shared DSP instance for live and sampled paths mixes unrelated history. Browser DelayNode DSP duplicates native behavior. Reject these approaches. Baking wet capture into PCM can double effects during replay. Prefer raw takes plus stack metadata unless the operator requests printed effects.

Additive wet gain can exceed full scale. Preserve the current engine's float mix behavior and test peak levels. Use a quiet audition fixture and confirm headroom during listening. Do not silently insert a limiter or normalize the dry path.

Voice summation changes float addition order. Require detached-stack fixture equivalence within 1e-6 where bit equality is unavailable. Keep raw capture PCM bit-identical. Output pointers may be mono or null; test both using the current sampler contract.

DSP unit tests must include impulse position/amplitude, feedback decay, ordered multi-stage composition, override precedence, path isolation, fractional delay, silence, long drain, repeated attach, wet zero, parameter rejection, maximum capacity, varied blocks, and flush. Integration tests must cover default/voice stack transitions at capture boundaries, live/sample/download consistency, chorus-trigger bounds, variants, manual taps, click exclusion, gain/mute, Stop/Panic/reset, loop wrap, atomic load failure, stale commands, logging thresholds, and native/WASM agreement.

Allocation tracing and sanitizer tests establish narrower facts than physical realtime performance. Hardware callback budgets are proposed acceptance targets. No latency, underrun, acoustic quality, mobile browser, or EliteDesk device result has been measured in this plan.

Throughput checkpoint after P1 is a deterministic PCM renderer shared by native and WASM fixtures. Reuse its signals and command logs in P2 and P3. Stop if later verification depends only on state snapshots or if contract coordination creates two independent command models.

## Appendix D. Links and reading list

Read [architecture](../architecture.md), [development](../development.md), the [performance contract](../../ui/practice/CONTRACT.md), [native performance guide](../../lib/performance/README.md), and [sampler guide](../../lib/sampler/README.md).
The superseding `docs/workstreams.md` currently lives in the coordinator's checkout. Reconcile it and the sibling plans at the integration base before implementation.
Installed planning skills are `/Users/anulman/.codex/skills/poteto-mode/`, `how/`, `technical-writing/`, `unslop/`, and `deslop/`.
Separate Before Serializing Shared State shaped the single-writer contract ownership and isolated checkout. Test Behavior, Not Implementation shaped PCM assertions and decoded-download checks instead of relying on attachment flags.
