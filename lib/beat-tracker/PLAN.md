# Beat tracker plan

Build a reusable C++ beat clock with an aubio listener and a browser microphone demo.
The clap follows the clock. Reliable audio adjusts its tempo and phase gradually.
Silence preserves the clock. Manual control persists until the user selects Follow.
Deliver BT-1, then BT-2, then BT-3. Each unit has its own observable checks.
The implementation is built. See `README.md` for use and `VERIFICATION.md` for results and remaining musical checks.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, such as a log, recording, screenshot, test result, or commit SHA.
The body is a how-to. The appendices explain the design and record planning evidence.

The program follows `/Users/anulman/.codex/skills/poteto-mode/playbooks/autopilot-stack.md` with the local adaptations below.
The operator lands BT-1, BT-2, and BT-3 in order. BT-3 includes the visual review.
The repository currently has no remote. Treat these identifiers as local work units until a remote is configured.
Do not invent PR links, cloud workers, missing model families, or scheduling capabilities.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [x] Present this plan and record the operator's instruction to begin implementation in the decision log.
- [ ] Read the installed `poteto-mode`, `swarm`, `architect`, `no-comments`, and `technical-writing` skills before execution. Record their version and paths.
- [ ] Record the actual branch and baseline SHA. The planning baseline is `be0154b` on `production`. `git show origin/main:` does not apply to this repository because no remote is configured.
- [ ] Record the runtime adaptation. Cursor's `/loop 1h` is unavailable in this session. Use explicit checkpoints after each verified unit. Post a status message when a result or decision changes.
- [ ] Use GPT-6.1 Sol at medium for coordination, Sol at high for implementation, and GPT-6 Astra at xhigh for the difficult follower design and final adversarial review. Set worker models explicitly. The main-session setting is controlled by the operator.
- [ ] On a hold instruction, stop every owner's writes and record its current evidence and remaining work.

### Spawn owners

- [ ] Assign one implementation owner to this coupled module. Let independent test and review workers use separate files and output directories.
- [ ] Follow the dependency chain `BT-1 -> BT-2 -> BT-3`. Base each child on the verified parent.
- [ ] Keep the coordinator as the only writer of this plan and the chain topology. Serialize changes to `include/beat_tracker.h`, `CMakeLists.txt`, and the shared engine.
- [ ] Run at most three workers concurrently in this environment. Ten verification lanes mean ten scenarios, executed in waves.
- [ ] Keep BT-3 ready for operator review with screenshots and a video before landing.

### PR mechanics, for every PR

- [ ] Record a local commit and its checks for each work unit. If a remote becomes available, resolve the forge once and create base-chained PRs without changing the delivery order.
- [ ] Run the applicable compiler warnings, tests, and JavaScript checks before each review-facing push. Save their logs.
- [ ] Read `no-comments` before review. Use the installed `/Users/anulman/.codex/skills/deslop/SKILL.md` before commits.
- [ ] Resolve review findings with a reproducible case. Record dismissed findings with the evidence that disproves them.

### Verdict and merge, for every PR

- [ ] Run the unit checks, ten live scenarios, and performance probe at the candidate head. Save the exact SHA and command with each result.
- [ ] Review the actual diff and evidence independently. Use Astra at xhigh for follower invariants and a second reviewer for browser lifecycle and timing.
- [ ] Treat missing or inconclusive evidence as an open item. After a small fix, rerun affected checks. Repeat broad testing only for a changed design or unresolved failure.
- [ ] Append each verified unit in dependency order. The operator owns landing. Revalidate evidence affected by a later change.

### Boot recipe, for every live lane

- [ ] Use an isolated output directory under `/tmp/beat-tracker-verify/<unit>/<lane>/`. Record the exact checkout SHA and dependency versions.
- [ ] For native lanes, run the scenario executable from a terminal and capture its command, exit code, and CSV output. Follow the installed `control-cli` skill using the available terminal tools.
- [ ] For browser lanes, serve `lib/beat-tracker/web` and its generated assets on localhost. Wait for the module-ready indicator before driving controls. Follow the installed `control-ui` skill using the available browser-control tools.
- [ ] Supply reproducible PCM fixtures through the same processor input used by the microphone. Also run real microphone sessions with steady claps, sung syllables, and a melody.
- [ ] Save each named PNG in the lane directory. Terminal lanes capture the visible terminal result. Browser lanes capture the relevant control and diagnostic state. Keep numeric traces alongside screenshots.

## Establish the clock and manual control (BT-1)

**Depends on.** None.

**Files.**

- [ ] Create `lib/beat-tracker/include/beat_tracker.h`, `src/beat_tracker.cpp`, `src/beat_clock.cpp`, and the internal clock header.
- [ ] Create `lib/beat-tracker/CMakeLists.txt`, `tests/clock_tests.cpp`, and `tests/clock_scenarios.cpp`.

**Build.**

- [ ] Define the types and caller usage in Appendix E before implementing the clock. Make one engine own commands, phase, and beat numbering.
- [ ] Advance the clock from explicit sample-frame ranges. Accept arbitrary block lengths and preserve the fractional beat position across calls.
- [ ] Implement seed, Apply BPM, tap, Manual, Follow, and Reset as commands. Validate external values at the C API boundary.
- [ ] Implement the command timing and lifecycle policies in Appendix E. Split a block at an eligible scheduled command frame. Return an explicit acknowledgment for applied, duplicate, stale, or rejected commands.
- [ ] Make the first tap claim Manual immediately. Preserve an existing tempo and align phase. Without a tempo, store an anchor until the second valid tap.
- [ ] Estimate tap tempo from recent valid intervals. Reject duplicate and impossible intervals, reset after a long gap, and define the supported BPM range in one configuration structure.
- [ ] Emit monotonic beat identifiers and timestamps. A manual phase reset can change future phase but never replays an already emitted beat.

**You see.**

- [ ] Run the native scenario executable and save a trace showing an immediate seeded clock, persistent manual control, and unchanged tempo during 20 seconds of silence.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `ctest --test-dir lib/beat-tracker/build --output-on-failure`. Cover long runs, fractional periods, arbitrary chunking, invalid inputs, tap sequences, command ordering, and no duplicate beat IDs.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Record that `be0154b` has no clock, then run the new seeded-clock scenario. Save `seed.png`. Pass when the head produces the requested cadence and a valid trace.
- [ ] Lane 2. Start without a BPM. Save `unstarted.png`. Pass when no clock beat is fabricated before a seed or sufficient taps.
- [ ] Lane 3. Run 20 seconds without observations. Save `silence.png`. Pass when cadence and beat numbering continue.
- [ ] Lane 4. Apply a new BPM. Save `apply-bpm.png`. Pass when Manual owns the new period.
- [ ] Lane 5. Tap a running clock. Save `running-taps.png`. Pass when the first tap claims Manual and the second establishes the requested interval.
- [ ] Lane 6. Tap an unstarted clock. Save `initial-taps.png`. Pass when one tap only anchors and two valid taps establish tempo.
- [ ] Lane 7. Inject bounce, a long gap, delayed taps, duplicates, and reordered taps. Save `tap-validation.png`. Pass when each rejection is explicit, event-time intervals survive delivery delay, and late taps never replay past beats.
- [ ] Lane 8. Replay identical commands with different audio chunk sizes. Save `chunking.png`. Pass when emitted sample positions agree within one sample.
- [ ] Lane 9. Run at 44.1 kHz and 48 kHz. Save `sample-rates.png`. Pass when time-based cadence agrees within sample quantization.
- [ ] Lane 10. Reset near a beat boundary and start again. Save `reset.png`. Pass when old-epoch events cannot appear in the new run.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure clock-processing time per render block and allocations after initialization. Also measure elapsed audio frames until a timestamped command affects the clock.
- [ ] Probe. Read `benchmark-checklist`. Run five alternating baseline and candidate passes with identical block sizes and consumed output. Use a no-op baseline driver at the empty baseline. Save raw samples and environment details.
- [ ] Baseline. Record the no-op driver first. Label the missing baseline feature and do not claim an application speedup.
- [ ] Rule. Fail on hot-path allocations, duplicated work, or command application later than the next eligible block after delivery. Target p99 clock work below 10% of the actual render-quantum duration.

**Review gate.** None. BT-1 is not review-gated.

**Merge.**

- [ ] Record the root's verdict for the exact head SHA with the unit, live, and performance logs.
- [ ] Preserve BT-1 as the base of BT-2. The operator lands the finished chain.

## Add aubio observations and gradual following (BT-2)

**Depends on.** BT-1.

**Files.**

- [ ] Create `lib/beat-tracker/src/aubio_detector.cpp`, `src/tempo_follower.cpp`, their internal headers, and `src/main.cpp`.
- [ ] Extend `include/beat_tracker.h`, `src/beat_tracker.cpp`, and `CMakeLists.txt` for the detector and native WAV runner.
- [ ] Create `tests/follower_tests.cpp`, fixture generation, and a trace comparator under `tests/`.

**Build.**

- [ ] Pin aubio source and build options. Use native file decoding only in the WAV runner. Keep the core input as mono float PCM.
- [ ] Start with a 2,048-sample window and a 512-sample hop. Expose these as configuration and test both supported sample rates.
- [ ] Emit a raw detector event only when `aubio_tempo_do` reports a beat. Read timestamp, BPM, and confidence at that event. A changed timestamp getter alone is not an event.
- [ ] Keep raw detections visible even when the follower rejects them. Gate follower trust on signal, freshness, robust period consistency, and relative confidence.
- [ ] Track tempo hypotheses independently of the output clock. Handle skipped beats as integer multiples. Require sustained evidence for an interpretation change.
- [ ] Tune against development fixtures, then freeze numerical acquisition and convergence criteria before acceptance runs. Use Appendix F as the starting contract. Keep synthetic observation tests distinct from end-to-end aubio tests.
- [ ] Include regression cases for a 120-to-180 BPM acceleration and its reverse. Blindly choosing the half/double candidate nearest the current tempo is forbidden because it can reverse the direction of the change.
- [ ] Apply bounded period and phase corrections to future clock motion. Treat the initial 2% limits as tuning candidates, then select values from reproducible ramp and phase-error traces.
- [ ] In Follow, acquire an unstarted clock from stable evidence. Coast on silence, stale events, or ambiguity. Require fresh observations after a manual-to-follow transition.
- [ ] On an unseeded start, use aubio's stable raw pulse interpretation when it is inside the configured BPM range. Do not wait for mathematically unique meter. Show the selected BPM and preserve it while exact half/double alternatives remain indistinguishable.
- [ ] Export raw detections, accepted hypotheses, rejection reasons, clock beats, phase error, and control changes from the native runner.

**You see.**

- [ ] Run a fixture containing steady pulses, a ramp, silence, and resumed pulses. Save the trace showing continuous clock beats and distinct raw detector events.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `ctest --test-dir lib/beat-tracker/build --output-on-failure`. Test stale events, skipped observations, half/double outliers, sustained tempo changes, Manual isolation, and fresh-evidence reacquisition.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Replay a seeded clock on BT-1 and BT-2. Save `seed-regression.png`. Pass when disabled following preserves the BT-1 clock trace.
- [ ] Lane 2. Replay steady 90, 120, and 180 BPM bursts at both rates with declared seeds and an unseeded variant. Save `steady.png`. Pass when acquisition, tempo, phase, and interpretation stability meet the frozen Appendix F bounds. Record every missed detection.
- [ ] Lane 3. Replay a 90-to-120 BPM ramp and its reverse. Save `ramps.png`. Pass when the synthetic follower meets Appendix F's tracking bound and end-to-end results meet their separately frozen bounds without duplicate beat IDs.
- [ ] Lane 4. Replay 120-to-180 BPM and 180-to-120 BPM transitions. Save `tempo-change.png`. Pass when the synthetic follower converges within the declared beat count and never reverses direction through alias folding. An unresolved audio interpretation is recorded as ambiguity, not convergence.
- [ ] Lane 5. Inject a brief half/double estimate. Save `octave-outlier.png`. Pass when the clock keeps its established interpretation.
- [ ] Lane 6. Insert 20 seconds of silence. Save `coast.png`. Pass when the clock continues and stale aubio getters cannot fabricate detection flashes.
- [ ] Lane 7. Resume after silence at a shifted phase. Save `reacquire.png`. Pass when fresh evidence gradually aligns the clock without catch-up beats.
- [ ] Lane 8. Apply Manual while a conflicting rhythm continues. Save `manual.png`. Pass when neither tempo nor phase changes from audio until Follow.
- [ ] Lane 9. Replay a recorded sung syllable phrase. Save `syllables.png`. Pass when uncertainty produces coasting and the trace explains each accepted correction.
- [ ] Lane 10. Replay a melody with sparse attacks. Save `melody.png`. Pass when the clock remains continuous and the report distinguishes musical usefulness from detector accuracy.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure per-block engine time, including hops that trigger aubio, and input-frame-to-observation availability. Count allocations and consumed events.
- [ ] Probe. Run five interleaved BT-1 and BT-2 passes through the same PCM driver. Include steady, silence, and transition fixtures. Save timing distributions and correctness checks.
- [ ] Baseline. Record BT-1's clock-only work first. Label aubio analysis as newly added work.
- [ ] Rule. Fail on unbounded queues or hot-path allocations owned by the module. Treat callback deadline feasibility as unresolved until the WASM browser probe in BT-3. Set fixture accuracy goals separately from CPU timings.

**Review gate.** None. BT-2 is not review-gated.

**Merge.**

- [ ] Record an Astra xhigh review of clock invariants, hypotheses, and the raw timing traces at the exact head.
- [ ] Preserve BT-2 as the base of BT-3. The operator lands the finished chain.

## Run the shared engine in the microphone demo (BT-3)

**Depends on.** BT-2.

**Files.**

- [ ] Create `lib/beat-tracker/scripts/build-wasm.sh` and generated-output ignore rules.
- [ ] Create `lib/beat-tracker/web/index.html`, `demo.css`, `demo.js`, `beat-tracker.js`, and `beat-worklet.js`.
- [ ] Create `lib/beat-tracker/README.md` with native build, WASM build, localhost serving, and manual test instructions.

**Build.**

- [ ] Compile pinned aubio and the shared engine with Emscripten. Build a worklet smoke test before writing the full demo. Verify exports and numeric behavior against the native fixture runner.
- [ ] Compile WASM before audio starts and instantiate it before processing live input. Preallocate PCM and event buffers. Avoid networking, filesystem calls, and memory growth in the process callback.
- [ ] Make the worklet the only owner of clock state. Fold incoming channel data to mono and buffer arbitrary block lengths into aubio hops.
- [ ] Advance clock time when the input has no channels. Keep the processing graph active with a silent output. Never monitor microphone audio through speakers.
- [ ] Timestamp commands and observations in one context epoch. Keep sample-frame origin mappings and bounded historical clock information for delayed beat observations.
- [ ] Use DOM event timestamps for taps and record the audio-time mapping uncertainty. Keep context epoch, capture generation, and forecast revision separate. Test delayed command delivery with an intentionally stalled page.
- [ ] Send bounded state snapshots and event batches to the page. Drop obsolete visual events on backlog and report drops. Never replay a burst of claps after a page stall.
- [ ] Render the clap from projected clock phase with `requestAnimationFrame`. Flash the raw aubio indicator when a detection arrives. Compute diagnostic agreement using event timestamps.
- [ ] Implement Start/Stop listening, optional Starting BPM, Apply BPM, Tap, Follow, Manual, and Reset. Show mic RMS and peak, clock BPM, raw BPM, and separate control and acquisition status.
- [ ] Treat browser suspension as a suspended transport. On resume, discard obsolete events and require fresh detector evidence. Keep a continuous clock through ordinary silence while the context remains running.
- [ ] Handle permission denial, missing devices, stopped tracks, repeated start/stop, and failed WASM loading with visible recovery actions.

**You see.**

- [ ] Open the served demo, start the microphone, and save a recording of the meter, clap, raw detector flash, and status during clapping, silence, and manual takeover.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run native tests and the browser fixture runner. Require sample-quantized native/WASM clock agreement for identical injected observations. Establish separate numeric tolerances for aubio output during the build spike. Verify command acknowledgments, bounded transport, and old-epoch rejection.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Compare identical injected observations and the same PCM fixture on BT-2 native and BT-3 WASM. Record that BT-2 has no browser UI. Save `native-wasm.png`. Pass when clock outputs agree within sample quantization, detector outputs meet their declared tolerances, and the visible clock runs.
- [ ] Lane 2. Start with a blank BPM and steady claps. Save `acquire.png`. Pass when the meter responds, Listening precedes acquisition, and the clock starts from accepted audio evidence.
- [ ] Lane 3. Start at 120 BPM in silence. Save `seed-coast.png`. Pass when the clap starts immediately and shows Coasting.
- [ ] Lane 4. Speed up and slow down steady claps. Save `ramp.png`. Pass when the trace shows bounded corrections and no unintended octave jump.
- [ ] Lane 5. Sing da-da phrases, then a melody. Save `voice.png`. Pass when both indicators and uncertainty are visible and the operator can judge musical usefulness.
- [ ] Lane 6. Tap or Apply BPM against conflicting audio. Save `manual-override.png`. Pass when Manual persists and the raw detector flash continues independently.
- [ ] Lane 7. Select Follow after Manual. Save `follow-again.png`. Pass when fresh evidence gradually adjusts the clock without a phase snap.
- [ ] Lane 8. Stop and restart the microphone in both Follow and Manual, including a delayed permission grant. Save `mic-lifecycle.png`. Pass when tracks release, mode and clock remain intact, cancelled streams close, and old detector evidence cannot enter the new capture segment.
- [ ] Lane 9. Suspend/resume the context and stall the page thread. Save `suspension.png`. Pass when suspension is explicit and no missed-event burst appears on recovery.
- [ ] Lane 10. Deny permission and retry, then reload with a failed WASM fetch. Save `errors.png`. Pass when each failure is visible and a fresh successful start recovers.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure actual worklet callback cost, including aubio-hop callbacks, queue depth, and clock-event-to-visible-animation delay. Also report acquisition time separately from CPU cost.
- [ ] Probe. Run five interleaved clock-only and full-engine browser passes with identical PCM, render quantum, device, and sample rate. Record block counts, audio underruns, dropped messages, correctness, and distributions. Follow `benchmark-checklist` before interpreting results.
- [ ] Baseline. Capture the clock-only worklet first. Keep native results as correctness references, not as browser performance denominators.
- [ ] Rule. Fail if p99 callback work exceeds 50% of the actual render-quantum duration or observed callbacks miss the deadline under the declared load. Keep zero steady-state backlog and target foreground animation within two display frames of the projected beat. If aubio exceeds budget, move only analysis to a Worker and rerun timing and lifecycle checks.

**Review gate.** The operator reviews before merge.

- [ ] Save screenshots from lanes 2, 3, 6, and 7 with the diagnostic traces.
- [ ] Record a 30-to-60-second video showing following, silence, manual override, and explicit return to Follow.
- [ ] Present the screenshots and video to the operator. Stop at review-ready for landing.

**Merge.**

- [ ] Record the root's final verdict at the exact head and close every finding or mark the remaining limitation explicitly.
- [ ] Deliver the chain for the operator to land in order, with build commands and the demo URL.

## Close the program

- [ ] Check each box only when its evidence exists. Record failed or inconclusive scenarios without marking them passed.
- [ ] Deliver the module, demo instructions, verified behavior, and remaining musical or browser limits.

## Appendix A. Prototype evidence

Planning uses disposable probes under `/private/tmp/beat-tracker-pstack/`. These are research instruments, not product code.
The repository baseline is `be0154b` on `production`. The probes are uncommitted. They have no separate branch or SHA.

The native probe is `toolchain/probe.cpp`, rerun by `sh /private/tmp/beat-tracker-pstack/toolchain/run.sh`.
Its `summary.csv` and `events.tsv` cover impulses and short bursts at 90, 120, and 180 BPM, at 44.1 kHz and 48 kHz.
Each fixture has 30 seconds of rhythmic input followed by 20 seconds of silence.

Observed on installed aubio 0.4.9 with the candidate 2,048/512 settings:

- All twelve cases produced zero reported beat events during the silence section.
- The last-beat getter still advanced into the silence interval. It cannot be used as an event detector.
- Confidence values exceeded one. Probability-style thresholds would misrepresent the API.
- The 180 BPM fixtures had median detected BPM near 90.8. The half-tempo problem is present in this synthetic test.
- Events were sparse in some steady fixtures, including 120 BPM at 48 kHz. A follower must handle skipped beats.

The local Emscripten command reports `4.0.24-git`. Its Homebrew directory name differs, so pin by the actual compiler output and a tested build.
WASM aubio compilation, browser callback cost, microphone latency, vocal accuracy, and musical usefulness remain unproven.
The synthetic results establish API behavior and failure cases. They do not establish performance on a voice or melody.
An independent rerun reproduced the summary and emitted-event traces. Getter snapshots during silence had small confidence differences, so byte-for-byte reproducibility is not claimed for that stream.
The retained check is `/private/tmp/beat-tracker-pstack/probe-verification.json`.

## Appendix B. Alternatives rejected

Animating directly from aubio events loses continuity when detections are sparse or absent. Keep a separate clock.
Using page timers as the clock couples musical timing to rendering and message delivery. Keep clock ownership in the engine.
Blindly folding raw BPM toward the nearest current tempo can turn a genuine acceleration into a deceleration. Keep independent hypothesis history.
Putting analysis in a separate Worker adds queueing, timestamp reconciliation, and another lifecycle. Start with one worklet engine and move analysis only if the measured callback budget requires it.
An automatic return from Manual contradicts the user's requested control. Follow is the sole command that releases manual ownership.

## Appendix C. Risks

BT-2 cannot infer the intended metrical pulse from every melody. Starting BPM and taps provide a prior. Report ambiguity and coast when evidence is weak.
BT-2's tempo, phase, and stability thresholds require recordings and measurable targets. Freeze the Appendix F criteria before acceptance runs. A failure requires a design change or an explicit limitation, rather than replacing the predicate with a trace-only check.
BT-3's 512-frame hop does not provide a 512-frame CPU deadline. A callback that finishes a hop must still fit its actual render quantum.
BT-3 cannot keep processing audio while the browser suspends the context. Show suspension separately from coasting.
The installed pstack bundle targets Cursor. Cursor agent classes, Claude/Grok model slugs, cloud VMs, and `/loop` are not provided by installing skill files.
The 18 cursor-team-kit skills are also installed locally, including `control-cli`, `control-ui`, and `deslop`.
Use available tools honestly. Discover browser, terminal, and recording binaries before choosing screenshot and video commands.
The initial planning reviews use independent instances of the inherited model. Astra xhigh provides an additional requested review, not evidence of cross-vendor model agreement.

## Appendix D. Links and reading list

- [Installed poteto mode](/Users/anulman/.codex/skills/poteto-mode/SKILL.md).
- [Installed CLI control skill](/Users/anulman/.codex/skills/control-cli/SKILL.md).
- [Installed UI control skill](/Users/anulman/.codex/skills/control-ui/SKILL.md).
- [Installed deslop skill](/Users/anulman/.codex/skills/deslop/SKILL.md).
- [Planning playbook](/Users/anulman/.codex/skills/poteto-mode/playbooks/multi-phase-plan.md).
- [Architecture skill](/Users/anulman/.codex/skills/architect/SKILL.md). Apply before implementing BT-1's public contract.
- [How skill](/Users/anulman/.codex/skills/how/SKILL.md). Apply to aubio integration and the browser graph when implementing BT-2 and BT-3.
- [Interrogate skill](/Users/anulman/.codex/skills/interrogate/SKILL.md). Apply to disputed follower choices and the final diff.
- [Decision-trail skill](/Users/anulman/.codex/skills/show-me-your-work/SKILL.md). Keep execution decisions with their evidence.
- [pstack source at the installed revision](https://github.com/cursor/plugins/tree/190d28736eff128ec94f502a22c7fe0c4b56cd37/pstack).
- [Aubio tempo API](https://aubio.org/doc/latest/tempo_8h.html).
- [AudioWorklet and WASM design](https://developer.chrome.com/blog/audio-worklet-design-pattern).
- [AudioWorklet processing blocks](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process).
- [Microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [Model selection](https://developers.openai.com/api/docs/guides/model-selection).

## Appendix E. Domain and public contract

Use a single engine with a tagged Follow or Manual control state and an Unstarted or Running clock.
Only Follow carries an acquisition state, either Listening, Following, or Coasting. Manual carries tap state and cannot contain Following.
The browser adapter owns transport and microphone lifecycle independently. Transport is Initializing, Running, Suspended, Faulted, or Disposed.
The microphone is Off, Requesting, Live, Muted, or Ended. Derive display labels from these typed states.
Manual with no tempo is valid while waiting for a second tap. Starting or stopping capture never changes the selected control mode.

Use a monotonic sample-frame timeline within each engine epoch. Represent the clock as an unwrapped beat position and a positive period.
Automatic phase corrections use a bounded temporary frequency offset. Keep total frequency strictly positive and integrate it over time.
Do not assign a phase jump for an audio correction. Emit each crossed integer beat exactly once.
Manual taps explicitly re-anchor phase while preserving emitted-event identity and invalidating obsolete forecasts.
Keep detector sample origins, capture origins, and current audio-context frames distinct and convert at their boundary.

The proposed C interface uses an opaque tracker handle and fixed-layout configuration, command, snapshot, and event records.
The caller creates the tracker, submits timestamped commands, processes mono PCM, reads bounded event output, and destroys the tracker.
Reject invalid ranges, nonfinite BPM, and stale epochs at the boundary. Keep allocation and object construction outside the audio callback.

Separate seeding from manual commands. A new tracker defaults to Follow, and `seed_bpm` supplies its optional initial clock.
Accept a seed only for an unstarted clock. Reject a later seed with an explicit AlreadyStarted acknowledgment. Seeding never changes an already selected control mode.
`set_manual_bpm` and `tap` claim Manual. `set_mode(Follow)` is the only release.
Use command sequence numbers and acknowledgments so a late snapshot cannot undo a newer manual command in the UI.

Commands carry engine epoch, monotonic sequence number, event frame, and timestamp uncertainty where applicable.
The browser `tap(timestamp)` takes milliseconds in the `performance.now()` time domain. Normalize DOM event timestamps to that domain before conversion.
Convert to an engine sample frame using a paired audio-time/browser-time anchor. Record mapping uncertainty and do not treat output latency as microphone input latency.
For timely commands, split processing at the event frame and order same-frame commands by sequence number.
A duplicate returns its recorded acknowledgment without applying again. Reject stale sequence numbers and stale epochs explicitly.
For a late tap, compute intervals from the original event times, claim Manual at the next processing boundary, and project the new phase anchor forward to that boundary.
Never roll back or emit retrospective beats. Reject taps whose event time precedes the last accepted tap.
Apply late BPM and mode commands at the next processing boundary and acknowledge that actual frame.
Reject command-queue overflow explicitly. A delayed valid command is different from one that was rejected.
Reset and fresh-capture commands are immediate lifecycle operations. Reject future lifecycle timestamps so analyzer allocation cannot occur inside processing.
Prepare their replacement analyzer between processing calls, reset its hop and energy state, and remap its sample origin to the current engine frame.

The browser adapter exposes `create({startingBpm})`, `startListening()`, `stopListening()`, `setManualBpm(bpm)`, `tap(timestamp)`, `setMode(mode)`, `reset()`, and `dispose()`.
The optional seed belongs to creation or an explicit seed command before the clock starts. Microphone restart never reapplies it.
Subscribers receive a state snapshot and separate clock and detector events.
Snapshots include epoch, command acknowledgment, frame timestamp, mode, transport, acquisition, clock BPM, raw BPM, confidence, level, beat position, and next beat time.
Detector events carry estimated beat frame and report frame. Clock events record an actual integer-phase crossing with an immutable sample frame and beat ID.
The snapshot's next-beat time is a replaceable forecast. A newer snapshot revision supersedes the previous forecast, including after a manual re-anchor.
The raw flash uses report arrival. The agreement diagnostic compares the estimated beat frame with the corresponding historical clock phase.

Use these lifecycle effects:

| Operation | Clock and ownership | Detector and browser resources |
| --- | --- | --- |
| Stop listening | Preserve mode, tempo, and phase progression. | Release owned microphone tracks. Clear follower evidence. Cancel pending capture requests by generation. |
| Start listening | Preserve the existing clock and mode. Repeated requests are idempotent. | Start a new detector segment with a recorded frame origin and fresh evidence. Close any stream returned by a cancelled request. |
| Suspend | Preserve mode, tempo, and phase. Freeze the visual clock while processing is suspended. | Invalidate old observation acceptance. |
| Resume | Continue from preserved phase without wall-time catch-up beats. | Start a fresh detector segment before following again. |
| Reset | Clear the clock and tap sequence while preserving the selected mode. | Clear events and evidence, increment the engine epoch, and reset detector origin. Capture remains explicitly controlled by Start/Stop. |
| Dispose | End the engine. | Release owned tracks and nodes. Close only an AudioContext the adapter created. |

A manual phase anchor increments forecast revision, not engine epoch. A capture restart increments capture generation, not engine epoch.
Prepare any replacement detector outside the processing callback, then swap at a block boundary. Keep lifecycle allocation out of the audio hot path.
Historical taps may have negative engine-frame anchors when the physical tap precedes audio engine startup. Other negative command frames reject explicitly.

The main program is a native WAV-to-trace runner in `src/main.cpp`.
The browser demo uses the same engine through the C interface, so its behavior can be compared with native traces.

## Appendix F. Acceptance bounds to freeze before verification

These are proposed starting bounds, not achieved results. Record the final values and fixture identities before acceptance runs.
Tune on separate development recordings. Keep held-out acceptance fixtures unchanged during the run.

| Fixture class | Starting acceptance requirement |
| --- | --- |
| Ideal observations at 90, 120, and 180 BPM | Acquire within six valid observations. Reach less than 2% tempo error and less than 50 ms median absolute phase error after acquisition. |
| Ideal 90-to-120 BPM ramp over 20 seconds and its reverse | Keep tempo error below 5% after the first four seconds. Preserve unique beat identities throughout. |
| Ideal 120-to-180 BPM step and its reverse with the intended pulse level declared | Reach less than 2% tempo error within 32 reference beats. A permanently coasting follower fails this test. |
| Brief half/double outliers and skipped integer beats | Preserve the established pulse interpretation and meet the steady-fixture error bounds after the disturbance. |
| End-to-end aubio burst fixtures | Acquire within eight audio seconds on the declared supported fixtures. In the 10-to-30-second evaluation window, target less than 2% tempo error and less than 50 ms median phase error against the declared pulse grid. |
| Unseeded ambiguous audio | Acquire using the stable raw aubio interpretation within the configured BPM range. Declare that pulse grid and evaluate consistency against the fixed choice. Do not switch the scoring grid per beat to hide octave jumps. |
| Manual with conflicting audio | Match the no-audio command replay exactly within sample quantization until explicit Follow. |
| Silence | Preserve accepted tempo and monotonically increasing beat identity for 20 seconds. |

For synthetic observation tests, control the observations, delays, confidence, skipped beats, and intended interpretation directly.
For aubio integration tests, feed PCM and score the actual detector and clock traces. A weak detector result cannot excuse a failed ideal-observation test.
Record both the fraction of time Following and the fraction Coasting. Trace completeness alone cannot establish useful tracking.
Real claps, sung syllables, and melody remain an operator-reviewed musical test in addition to these numeric checks.

## Appendix G. Execution results

BT-1, BT-2, and BT-3 are implemented. The native, WASM, fixture, and browser-adapter suites pass.
Chrome was driven through the real demo for acquisition, Manual override against a conflicting input, silence coasting, and return to Follow.
See `VERIFICATION.md` for the evidence boundaries and the exact measurement context.
The unchecked publication, per-lane screenshot, video, and human musical-review boxes are not claimed complete.
No remote is configured. Local commits were deferred because the configured 1Password signer needs interaction.
