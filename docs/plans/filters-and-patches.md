# Build live-first voice effects and cached playback

Give performers ordered effects stacks per voice, controlled by song cues, the performance UI, and peripherals.
Process live voice first and cache the processed result for sampled playback and downloads.
Keep the stack and effect contracts generic. Slapback is the first DSP example, with chorus, echo delay, guitar-like voice processing, and grimy synth-like processing planned as additional types.
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

## Define generic effects and render live input (P1)

**Depends on.** None. Operator routing, mono output, slapback defaults, and tail decisions are recorded below. Implementation still requires explicit go.

**Files.**

- [ ] Add portable DSP under proposed `lib/patches/` with a C++ header, source, CMake target, README, and deterministic PCM tests. Final filenames follow existing module conventions.

**Build.**

- [ ] Define generic effect descriptors, ordered stacks, prepare/process/reset operations, typed parameter schemas, latency, tail policy, and instance state from Appendix B. Implement slapback as one effect type. Prepare DSP and transition resources before processing. Keep tests independent of devices and the performance ABI.
- [ ] Process mono microphone input into equal left and right channels, then run generic full-output effect stages. Implement slapback delay, feedback, ramps, draining, flush, and bounded updates. Preserve existing stereo file input. Do not require every effect to retain a unity dry path or independent stereo channels.

**You see.**

- [ ] Render a mono microphone impulse to equal left/right PCM, with a 100 ms slapback repeat on both. Separately render a stereo isolation fixture for the slapback type. Save PCM and assertion reports.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add native DSP tests for all Appendix C signal cases. Run the new module's documented CTest command with sanitizers in a separate build.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Render dry impulses on trunk and head. Record that trunk lacks slapback. Save `p1-dry.png`. Pass when dry PCM is unchanged and head adds the expected echo.
- [ ] Lane 2. Render a mono mic impulse at 44,100 Hz. Save `p1-left.png`. Pass when left equals right and both first echoes occur at frame 4,410.
- [ ] Lane 3. Render mono mic and separate stereo-source fixtures at 48,000 Hz. Save `p1-right.png`. Pass when mono appears equally on both outputs and a right-only slapback source stays isolated with its echo at frame 4,800.
- [ ] Lane 4. Feed a generic two-stage order fixture and slapback with block sizes 1, 127, 128, 511, and 1,024. Save `p1-blocks.png`. Pass when stage order matches the independent reference and block partitioning changes PCM by at most 1e-6.
- [ ] Lane 5. Bypass after an impulse. Save `p1-bypass.png`. Pass when old echoes drain and later input has no new echoes.
- [ ] Lane 6. Detach a stage from a two-stage stack, reattach while draining, and render proposed cache-stop release cases. Save `p1-reattach.png`. Pass when stage order is explicit, each tail has one owner, and cache release preserves the reference tail without repeating the baked stack.
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

**Depends on.** P1 and the coordinated Performance Engine contract milestone. Processed caching is an operator requirement, not an open storage question.

**Files.**

- [ ] Edit sampler rendering and tests under `lib/sampler/`. Coordinate `lib/performance/` headers, source, model, bridge, generated ABI, and browser audio output routing with Performance Engine.
- [ ] Update `docs/architecture.md`, `docs/development.md`, and module documentation alongside the verified route change.

**Build.**

- [ ] Process live microphone through the default or capture-target voice stack first. Cache that processed voice PCM before destination and voice output gains. Play cached PCM without reapplying its baked stack, then apply voice gain/mute and master gain before summation. Keep click outside voice effects and captured PCM.
- [ ] Replace the browser dry-microphone recording bypass with explicit processed-live and processed-sample output routing. Mix the processed live stem exactly once into each eligible configured output and the recording route. Duplicate mono microphone equally to left/right before effects. Preserve stereo caches and stereo source material. Apply the exact monitoring predicate in Appendix B.
- [ ] Execute patch cues at existing C++ segment boundaries. Commit resource replacement only while stopped after complete validation and preparation.
- [ ] Publish logical voice, stack revision/order, capture route, effect instance, bypass, drain activity, resolved parameters, and effective frame without callback allocation. Keep tail state separate from sample loop lights.
- [ ] Audit capture arm and commit preparation alongside stack preparation. Current `arm()` reaches `st_prepare()` before dispatch, so a command being native does not establish callback safety.
- [ ] Add bounded observer delivery and DEBUG/INFO/WARN host logging. Keep PCM artifacts debug-only and all formatting, serialization, and IO off the realtime thread.

**You see.**

- [ ] Render live voice first with capture entry selecting its voice stack and exit restoring the default. Cache the processed segment and replay it without another same-stack pass. Save native and WASM live, cache, playback, and download PCM plus applied-event receipts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend `lib/performance/tests/native_tests.cpp`, sampler native tests, and WASM integration tests. Run native CTest, `npm test`, `npm run build`, and typecheck.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Run existing capture, commit-and-autoplay, variants, and manual-hit fixtures on both builds. Save `p2-regression.png`. Pass when positions and detached-stack playback remain equivalent, with processed-cache changes recorded as intentional.
- [ ] Lane 2. Enter and exit voice capture inside a block, including a fractional-beat cue. Save `p2-cue.png`. Pass when live routing, capture boundary, and first affected sample match the declared engine frame.
- [ ] Lane 3. Send the same cue-attachment performance operation through UI-equivalent and peripheral-equivalent commands. Save `p2-controls.png`. Pass when desired state and output agree, without granting peripherals venue-parameter edits.
- [ ] Lane 4. Duplicate and reorder commands across a run change. Save `p2-order.png`. Pass when acknowledged retries do not retrigger a stack transition, stale commands fail explicitly, and active program state stays immutable.
- [ ] Lane 5. Cache live voice after its stack and replay while new live input uses the default stack. Save `p2-capture.png`. Pass when cache equals the processed pre-gain live segment and replay has exactly its printed echo, with no second processing pass or extra dry mic.
- [ ] Lane 6. Enable mandatory count-in click. Save `p2-click.png`. Pass when click PCM has no added echoes and the voice cache receives only its selected processed live stem, excluding click and mixed sample playback.
- [ ] Lane 7. Resolve voice defaults, effect/voice overrides, and web venue overrides in a two-stage stack. Mute/unmute its output. Save `p2-mute.png`. Pass when order and precedence match, mute is silent while live state advances, and the pre-gain processed cache stays unchanged.
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

- [ ] Show the logical voice, ordered stack, voice defaults, and per-effect venue overrides in the web UI. Tune delay, feedback, wet amount, and future effect parameters there. Map a simulated button to a declared cue and a dial only to declared performance operations such as chorus-voice triggers. Do not add peripheral parameter-tuning controls.
- [ ] Demonstrate live voice through default slapback, capture entry selecting a voice stack, processed caching, cached playback without another baked-stack pass, and exit restoring the default. Change wet in the web UI and detach through a cue/button mapping. Preserve relay-free local WASM commands.
- [ ] Record processed live voice and processed sample stereo plus dry click. Remove the old dry microphone recording bypass. Verify that printed voice processing reaches native, browser monitoring, and downloads through explicit destination routing. Test different devices, same USB interface, same non-USB device, and unknown identity as distinct cases.

**You see.**

- [ ] Produce a browser take with the requested slapback changes and decode the download to verify audible channel content. Label simulated peripherals explicitly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Extend practice lifecycle, voice-recording, worklet, and compiled-song tests. Run `npm run typecheck`, `npm test`, `npm run check:layout`, and `npm run build`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head.

- [ ] Lane 1. Regression lane against trunk. Perform the same synthetic-microphone take on trunk and head. Save `p3-take.png`. Pass when capture and download complete and head adds the intended live and sample effects. Record the intentional live-route change.
- [ ] Lane 2. Run local WASM without a relay or Sheets helper. Save `p3-local.png`. Pass when UI and cues control the patch throughout a take.
- [ ] Lane 3. Use a narrow viewport. Save `p3-mobile.png`. Pass when target, pending state, controls, and errors are readable and usable.
- [ ] Lane 4. Tune per-effect venue settings in the web UI during live processing. Separately turn the simulated dial for a declared chorus-voice operation. Save `p3-knob.png`. Pass when web tuning matches native state, capture provenance records applied revisions, and the dial never edits venue parameters.
- [ ] Lane 5. Reconnect the simulated controller. Save `p3-reconnect.png`. Pass when it recovers a snapshot without toggling attachment unexpectedly.
- [ ] Lane 6. Detach live slapback during audible feedback and switch a non-unity reference stack. Save `p3-tail.png`. Pass when each declared tail drains once, gain stays continuous, and generic transitions do not assume a unity dry path.
- [ ] Lane 7. Stop during capture, restart, and Panic. Save `p3-panic.png`. Pass when no old echo returns and a completed download remains accessible.
- [ ] Lane 8. Decode the downloaded take and test the device monitoring matrix. Save `p3-download.png`. Pass when live and cached voices contain the intended effects once, click stays dry, mono reaches both channels, eligible monitors/room outputs receive wet live audio, and ineligible live monitoring is gated without muting the recording.
- [ ] Lane 9. Switch songs while stopped and reject an unsupported patch definition. Save `p3-song.png`. Pass when no old attachment leaks and the rejected load preserves prior configuration.
- [ ] Lane 10. Run the native host simulation through identical cue/control logs. Save `p3-native.png`. Pass when effective engine frames and state match WASM. Record physical-device testing separately.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure command delivery-to-application delay, native effective frames, event drops, and complete callback duration on baseline and head. Separate UI receipt latency from audio time.
- [ ] Probe. Interleave dry and patched takes with identical synthetic input and a bounded 100-updates-per-second web parameter burst and separate simulated performance-control burst. Capture native receipts and browser diagnostics.
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

Operator decisions read directly through the GitHub API on October 27, 2026 supersede the initial sample-only and raw-take proposals. Review anchors were matched to their original `b793268` and `4564ab9` diff context before applying short confirmations.

[Generic effects](https://github.com/anulman/show-tools/pull/2#pullrequestreview-5662230926), [live-first processed caching](https://github.com/anulman/show-tools/pull/2#discussion_r4385051100), [mono to left/right](https://github.com/anulman/show-tools/pull/2#discussion_r4384972761), [monitoring condition](https://github.com/anulman/show-tools/pull/2#discussion_r4385119436), [web-only venue tuning](https://github.com/anulman/show-tools/pull/2#discussion_r4385122810), and [button identity](https://github.com/anulman/show-tools/pull/2#discussion_r4385154502) are requirements. [Defaults](https://github.com/anulman/show-tools/pull/2#discussion_r4385052420) and [tail/Start semantics](https://github.com/anulman/show-tools/pull/2#discussion_r4385053505) were confirmed on the first plan, and [tail/Start semantics were confirmed again](https://github.com/anulman/show-tools/pull/2#discussion_r4385124975) on the revised plan. [Per-voice stacks](https://github.com/anulman/show-tools/pull/1#discussion_r4384882009) require voice-wide and effect/voice settings, capture-time default/voice stack switching, and dial-triggered effects such as chorus voices. [All voice paths](https://github.com/anulman/show-tools/pull/1#discussion_r4384940894) must receive patches, including live voice and downloads. [Logging thresholds](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380) apply engine-wide.

- `lib/performance/src/performance_engine.cpp:205` captures microphone PCM before rendering. Click adds directly to outputs at line 218, followed by sampler output at line 229.
- `lib/sampler/src/sample_engine.cpp:304` renders individual voices directly into final buffers. Line 315 applies channel gain/mute per voice. Per-channel patch input does not exist yet.
- `lib/performance/src/performance_engine.cpp:530` splits audio at beat crossings, using the ceiling of the event frame for discrete samples. Patch cues must use this existing timing rule.
- `lib/performance/src/performance_engine.cpp:116` centralizes silence. `pf_stop()` at line 377 and epoch reset at line 247 reach that path.
- `ui/practice/audio.ts:66` sends worklet output to demo recording. Lines 97 through 110 build a separate microphone branch, downmix it to mono, and send it directly to recording.
- `lib/performance/README.md` documents single-thread engine ownership, command deduplication, stopped configuration, fixed WASM memory, and native build commands.

The route findings came from direct source inspection and a separate read-only explorer. No services started. No empirical sound claims are made. P1 contains the rendered sketches that compare ramps and delay updates before production integration.

## Appendix B. Define the patch and its contracts

### Define generic effects before the first DSP type

Give each effect type a descriptor with a stable type ID/version, a typed parameter schema and bounds, supported input/output channels, maximum prepared state, latency in frames, reset behavior, and bounded tail behavior. Separate immutable definitions from mutable prepared instances. Use prepare, process, parameter-update, drain, and reset operations independent of the effect algorithm. Processing produces complete output PCM. The stack cannot assume an additive wet term, unity dry gain, fixed delay memory, or identical channel topology for every type.

Keep shared C++ DSP under `lib/patches/`. Slapback is the first type, not the meaning of patch. Additional descriptors must accommodate chorus/modulation, echo delay, nonlinear guitar-like timbre, and synth-like transformations. Their exact sound algorithms remain future design work. Do not invent guitar pitch tracking, synthesis, polyphony, or licensing decisions from those sound descriptions. Use small gain and nonlinear reference stages in tests to prove generic noncommutative ordering without declaring new production sounds implemented.

A logical voice is a performer-facing part, such as cowbell, not a button or one sampler playback allocation. Give it a stable voice ID, voice-wide defaults, and an ordered stack. Resolve type defaults first, compatible voice-wide defaults second, and per-effect/voice overrides last. Apply session venue overrides from the web UI at their declared final precedence and record the resolved revision. Validate typed parameters against their effect descriptor. Apply voice gain/mute after processing and before destination mixing.

### Process live voice before caching

Duplicate the mono microphone sample into left and right at equal unity amplitude before the selected stack. An effect may deliberately create stereo differences. Do not make the stereo-isolation fixture a rule that mutes one side of mono microphone output. Preserve existing stereo input material without downmixing it.

Outside capture, send live input through the default live stack. At a native capture-entry boundary, select the target voice's stack. Process that live signal first, then copy its processed stereo output into the take cache before voice gain/mute and destination gains. The selected live voice stem, its cache source, and its contribution to downloads use that same computed result. Retired tails belonging to another logical voice keep their provenance and join destination mixes separately; do not copy them into the new voice cache unless the compiled route explicitly requests that inclusion. At capture exit, restore the default live stack. Do not offer raw takes as the primary sampled playback model.

Keep a prepared bounded history of already-processed output with voice/route and graph revision even before capture is armed. A retrospective `cl` commit reads the matching processed history for the requested frame interval. If matching voice/route history is absent, report unavailable; do not substitute raw input or process an old segment with the current stack. Coordinate the retained duration, history capacity, and diagnostics with Performance Engine.

Cache identity includes voice ID, take/variant ID, applied stack revision, effect parameter revisions, and the source frame interval. Parameter changes within a take need a preallocated revision timeline sized at preparation. Coalesce superseded pending venue updates before acceptance. If the timeline is full, reject further revision-changing updates before applying them and report capacity outside the callback. Continue capture with the last accepted settings. Never accept an update whose applied provenance cannot be retained. Looping a cached segment or playing a variant reads this processed PCM and does not run the already-printed stack again. Future stack or venue edits affect new live processing and captures; they do not silently reprocess an existing cache. Performance Engine agrees this cache-edit rule and an explicit recapture UI; it remains a documented implementation policy rather than a reason to run the baked stack again.

A chorus-triggered child voice is an explicit bounded performance operation with source voice/take, routing, lifetime, and prepared resource limits. Its graph declares whether it reads a printed cache or a new source. Do not disguise repeated application of the baked stack as a chorus operation. Additional replay effects require an explicit new stage and provenance, rather than another automatic same-stack pass.

Live input has one processing-route owner per frame. If captures overlap, the compiled route must identify which stack produces live output and whether multiple captures copy that same processed result. Reject an ambiguous processing route during load. Do not send the mono microphone independently into every voice and sum it repeatedly. Coordinate capture failures, commit-and-arm, cancellation, limits, and normal exit with Performance Engine.

Cache the frame interval selected by the sampler cue. Store a bounded spill-tail representation separately from the musical interval; never extend a loop implicitly. Natural stop/detach tails remain required for cached playback. A fixed end-of-take spill alone cannot represent every arbitrary playback stop position. P1/P2 must prototype a bounded representation for the supported stop positions, comparing printed tail material with retained prepared state/checkpoints. Do not reapply the baked stack to the cached audible signal. If faithful release needs auxiliary source/state retention, size and declare it as part of the processed-cache resource model rather than replacing processed playback with raw takes. Preserve exact capture, variant, sparse-hit, commit-and-autoplay, and retained-version behavior in fixtures against the processed source. Inspect whether sparse onset analysis needs a separate pre-effect signal while stored take PCM stays processed. In particular, quiet/shifted attacks after nonlinear or delay stages may change slicing. This is a verification requirement, not a reason to reinstate dry sampled playback.

### Route generic transitions and bounded resources

Use a full-output complementary crossfade for generic stack changes. Latency-align the old and new outputs using descriptor metadata and prepared buffers. Reserve transition state in advance. Never assume arbitrary effects expose a removable dry component. Define wet-tail continuation separately from the crossfade so it cannot fade out and then jump back in. Effects declare a zero-input drain policy; old instances receive no new live source after handoff. Prototype sustained signals, impulses, a non-unity-gain stage, and a nonlinear stage before choosing envelopes and downstream tail routing.

Slapback may expose its wet-only tail internally to preserve natural repeats, but that is a type-specific capability. Generic effects that cannot separate a tail use a declared full-output drain transition. Test that both choices add each tail once. Account for the same transition output in the cache and audible stem at the same frame, rather than recomputing them with diverging history.

Prepare active chains, transition buffers, capture-cache capacity, latency compensation, and retired tails before activation. Size capacity from declared voices, stack lengths, channel counts, sample rate, and each descriptor's maximum resources. Button count does not determine voice count. Validate the complete song and its required performance operations against these prepared limits. Reserve capture routing independently from optional graph-edit tails. Reject an optional edit before mutation if reserved tail slots are occupied; do not make an existing capture fail or allocate because of that edit.

For the first slapback-only memory fixture, a single stereo ring at 48 kHz and 250 ms needs about 96 KB before guards. Multiply by admitted instances, including transition and retired versions, to report the actual budget. This is an example calculation, not a universal effect-memory layout. Chorus and nonlinear effects declare their own resources. No dependency adoption or generic four-voice/four-stage product limit is decided here.

### Route processed audio to outputs and recordings

Provide distinct C++ stems or an explicit destination matrix for processed live voice, processed cached samples, and click. Remove `syncRecordingVoice()`'s dry-microphone recording bypass when integrating these outputs. Downloads combine the processed live stem, cached playback, and dry click once each. Neither click nor already-mixed speaker output feeds the voice cache.

Enable live monitoring to every configured monitor and room output when input and output are different devices, or when they are the same confirmed USB audio interface. In logical terms, eligibility is different physical devices OR the same physical device confirmed as a USB audio interface. If input and output are the same non-USB device, do not monitor live voice. Downloads remain processed regardless of that monitoring decision. Sample playback and click keep their explicit output routes. Global Stop/Panic overrides all live monitoring eligibility.

Compare physical device identity, not an input ID string with an unrelated output ID namespace. Browsers may lack reliable USB classification or physical identity. Resolve known metadata in the host adapter and expose explicit device annotation in web settings when automatic classification is unavailable. Treat unknown identity/classification as unresolved eligibility and keep live monitoring off until the required device facts are supplied. Do not silently equate unknown with different. Verify actual browser output-selection support separately from simulated destination routing. Record which configured monitors and room outputs received audio.

### Implement slapback as one generic effect type

Confirmed slapback defaults are 100 ms delay, zero feedback, 0.25 wet, and unity dry. Delay range is 40 to 250 ms. Feedback range is 0 to 0.7. Wet range is 0 to 1. Parameters must be finite. Reject unsupported values atomically instead of silently clamping them.

For settled parameters, compute delayed sample d[n] from the ring, write x[n] + feedback * d[n], and output x[n] + wet * d[n]. Keep left and right rings independent. Mono sample playback feeds both equally. Never downmix stereo samples or feed click into the rings.

At integer delays with a unit impulse, expected echoes are wet at D, wet times feedback at 2D, and wet times feedback squared at 3D. Choose D as delay seconds times sample rate, with fractional linear interpolation for noninteger positions. The 100 ms fixture has exact integer positions at both tested rates.

Use 5 ms linear ramps for input send and wet attachment. Smooth wet and feedback updates over 5 ms. Change delay by crossfading old and new read taps over 20 ms instead of abruptly moving a read head. Use the convex blended delayed value for feedback. Coalesce rapid updates into a bounded latest desired value; verify the final settled value and audible transition before selecting this scheme.

Prepare slapback rings for maximum delay plus interpolation guards and scratch outside processing. Derive allocation from admitted sample rate and instance count. Sample-rate changes require stopped re-preparation. No external dependency is proposed for slapback. Preserve repository licensing for new source. These rules do not prescribe the state layout or dry gain of other effect types.

### Apply the confirmed lifecycle states

Use detached, active, bypassed, and draining states per effect instance, with desired state and current transition recorded separately. The operator confirmed natural channel-stop/detach tails, immediate global Stop/Panic silence, and restoration of song defaults at Start. Track the active live route and stack transition independently. A bypassed instance remains attached. A detached instance retains only its prepared slot and definition.

- Attach from detached resets the instance through its descriptor and transitions to its full output. For slapback, ramp input send and wet gain. Reattaching an unchanged draining instance may resume compatible history according to the type descriptor. For stack edits, reuse a chain only when graph and parameter revision match; otherwise use prepared replacement state and retire the old tail. Never render shared mutable state twice or add a second dry component.
- Soft bypass transitions to the declared bypass output while the prior instance drains with zero input. Detach follows that type's drain policy and becomes detached when the tail ends. Slapback uses a send ramp and its separated wet tail; other effects need not expose a wet parameter. Within a serial stack, retain a prepared old chain and follow its descriptor's declared full-output or separated-tail transition policy. Stable stage IDs do not imply shared mutable state between old and new chain renders. Count retained chains against capacity and reject excess edits explicitly. Do not move a delayed signal around downstream effects without defining its route.
- Detect drain completion using the descriptor's state and tail bound, not one silent output sample. For slapback, inspect bounded ring energy, use a proposed 1e-6 amplitude threshold, and cap drain at 12 seconds with a final 5 ms fade. Validate those implementation limits during P1. Other effect types declare their own finite release bound and completion rule.
- Voice mute and gain apply after the stack, including its tails. Continue advancing rings during mute. Unmute may reveal the currently decayed tail, while loop phase remains intact.
- A voice stop cue stops its cached playback. Let active effect tails drain naturally according to the confirmed policy. A cached take needs a prepared release representation to preserve natural tails after its loop/source stops. Require rendered proof across supported stop positions; do not claim the cached PCM alone can reconstruct missing effect state or exempt sampled playback from the confirmed tail behavior. If the voice owns the live capture route, ending that capture also restores the default live route. Global Stop and Panic immediately silence and clear all patch history, preserving the existing global silence promise. A hard cut can click and is deliberate for emergency silence.
- Every capture exit, including failure, Stop, Panic, and capacity limit, releases its live route and restores the default route or the stopped state. Global Stop/Panic gate incoming live processing and every audible voice output as well as clearing history. Reopening the microphone cannot regenerate echoes until explicit Start or a separately authorized monitoring lifecycle boundary. Normal capture exit during a running take restores the default live route without that global gate. Global Stop preserves patch definitions and desired settings while stopped. Start reinitializes history and applies the compiled song's initial attachments, clearing manual overrides. Panic also clears manual overrides and detaches instances. Coordinate these confirmed lifecycle distinctions with Performance Engine.
- Reset, engine disposal, song replacement, and clock discontinuity clear history and attachment state. Failed replacement preserves the prior complete configuration. Successful replacement installs the new song's initial state only at the agreed lifecycle boundary.
- A normal loop wrap retains attachment and tails. Repeated attach cues are idempotent. A cue may explicitly detach or reset if the arrangement needs silence at a loop edge.

### Submit semantic requirements to Performance Engine

The owner proposed versioned semantic JSON independent of the performance binary ABI. Accept that separation. Use stable song, resource, cue, instance, and target IDs plus a program digest. Song assignments stay under `songs/`.

Example semantic intent uses buttonId `R1`, a compiled cue mapping to voiceId `cowbell`, stackId `cowbell-effects`, effect instanceId `cowbell-slap`, and resourceId `slapback-short`. `R1`, `R2`, `L1`, and `L2` are button IDs, never voice IDs. Cue mappings resolve a button to a voice and operation at that musical position. Capture entry selects `cowbell-effects`; exit restores `default-live-effects`. The cache retains voice `cowbell` and the printed stack revision independently from the button that invoked it. This example is a schema requirement, not a new parser syntax or an approved binary layout.

Require ordered stack assignment, attach, detach, explicit bypass boolean, voice-default edits, per-effect/voice overrides, and atomic parameter updates. Identify stack revision, stage order, logical voice, and signal path separately. Allow a performance dial mapping to emit a typed, bounded operation such as chorus-voice triggering; admit it only when its DSP and resources exist. Per-effect venue values are adjusted in the web UI only, with no new peripheral controls for those values. Performance Engine reports current DYC knob tokens `[4d-,d,-1d],-3d]` and `[4d-`, plus an A17 chorus/video note. Treat these as unresolved semantic requests for the compiler and DSP owners, not an existing chorus capability or a DSP-side parser grammar. Use desired states rather than toggles. An invalid target, unknown resource, unsupported operation, nonfinite parameter, or exhausted slot fails explicitly. Reject unsupported patch capability at compile/load, before starting playback.

Use the owner's revised command envelope with producerId, commandId, producerSequence, runId, target, action, and timing. Honor existing identity encoding and bounded deduplication. Do not promise persistent exactly-once delivery. Freeze the active compiled program for the run, so its digest cannot change during playback. Validate replacement only while stopped instead of adding per-block stale-digest recovery. Reject old-run commands at the host boundary. Define overflow and late policies in the coordinated contract.

Resolve immediate peripheral commands at the next process boundary after engine acceptance. Resolve cue timing, including retrospective processed-history capture and quarter-, half-, and three-quarter-beat offsets, in C++ using the shared transport and actual measure length. External arrival time never becomes a clock. For future-frame commands, split blocks at their accepted effective frame. Report rejection or explicit late application rather than backdating a state change.

Publish engineSessionId, runId, epoch, programDigest, sourceSequence, effective frame, sampleRate, command identity, applied revision, and result. Patch state includes logical voice, stack revision and stage order, current live route, per-path instance identity, attachment, bypass, resolved parameters and their override sources, and tail activity. Preserve dropped-event counts and snapshot recovery. Keep tail activity distinct from channel looping and cue-light state.

Validate and prepare every patch definition and reference while stopped before swapping song state. Require atomic song/resource replacement and no allocation at the cue. Include the current capture `arm()` call to `st_prepare()` in the preparation audit, not just new DSP memory. Performance Engine owns any header changes, ABI version increase, and generated bridge updates. Filters supplies DSP interfaces and conformance fixtures. EliteDesk maps peripheral inputs to these commands without owning musical timing.

### Keep logs outside processing

The operator set DEBUG verbosity for debug runs with rich artifacts, INFO for actual practice, and WARN for performance. Apply this policy engine-wide, not just in effects code. Serialize and write logs, PCM exports, and plots outside the realtime path. Use bounded preallocated debug traces and copied observer records with overflow counters. Disable rich PCM capture outside explicit debug runs. Never make cue dispatch, processing, acknowledgments, or correctness state depend on diagnostic verbosity.

### Record confirmed decisions and remaining details

The operator confirmed 100 ms single-repeat slapback defaults and web-only per-effect venue adjustment. Channel stop and detach let active tails finish. Global Stop and Panic cut immediately. Start restores song defaults. Do not ask these questions again. Live processing first, processed caches, mono to left/right, distinct button and voice IDs, and the monitoring condition above are also settled.

The coordinated proposal keeps existing printed takes unchanged by later venue edits and makes recapture explicit in the UI. Exact commit/loop boundary continuity and the bounded representation of required cached stop tails remain to agree. Keep exact musical cache intervals and preserve natural tails separately, without lengthening loops or running the printed stack twice. The remaining decision concerns representation and resource cost, not whether the confirmed tails are optional. Retrospective `cl` means reading already-processed history, not retrospective effect editing. These details do not reopen processed caching or confirmed natural tails for active DSP. Unknown physical device identity requires device facts or explicit annotation, not another product choice about the monitoring rule.

## Appendix C. Record risks and alternatives

A master-output delay includes click and cannot select a voice. A sample-only effect omits the required live voice. A single shared DSP instance for live and sampled paths mixes unrelated history. Browser DelayNode DSP duplicates native behavior. Reject these approaches. Caching processed live output is required. Reapplying its printed stack would double effects, so bypass that stack on cache replay and retain processing provenance. Do not reinstate a raw-take alternative.

Additive wet gain can exceed full scale. Preserve the current engine's float mix behavior and test peak levels. Use a quiet audition fixture and confirm headroom during listening. Do not silently insert a limiter or normalize the dry path.

Voice summation changes float addition order. Require detached-stack fixture equivalence within 1e-6 where bit equality is unavailable. Require cached PCM to equal the processed live source segment exactly before output gains. Output pointers may be mono or null; test both using the current sampler contract.

DSP unit tests must include impulse position/amplitude, feedback decay, generic noncommutative stage composition, override precedence, mono-to-stereo mapping, full-output transitions, latency alignment, processed cache equality, no repeated baked-stack pass, fractional delay, silence, long drain, repeated attach, wet zero, parameter rejection, maximum capacity, varied blocks, and flush. Integration tests must cover default/voice stack transitions at capture boundaries, live/cache/download consistency, the exact monitoring truth table, web-only venue tuning, button/voice mapping, chorus-trigger bounds, variants, manual taps, click exclusion, gain/mute, Stop/Panic/reset, loop wrap, atomic load failure, stale commands, logging thresholds, and native/WASM agreement.

Allocation tracing and sanitizer tests establish narrower facts than physical realtime performance. Hardware callback budgets are proposed acceptance targets. No latency, underrun, acoustic quality, mobile browser, or EliteDesk device result has been measured in this plan.

Throughput checkpoint after P1 is a deterministic PCM renderer shared by native and WASM fixtures. Reuse its signals and command logs in P2 and P3. Stop if later verification depends only on state snapshots or if contract coordination creates two independent command models.

## Appendix D. Links and reading list

Read [architecture](../architecture.md), [development](../development.md), the [performance contract](../../ui/practice/CONTRACT.md), [native performance guide](../../lib/performance/README.md), and [sampler guide](../../lib/sampler/README.md).
The superseding `docs/workstreams.md` currently lives in the coordinator's checkout. Reconcile it and the sibling plans at the integration base before implementation.
Installed planning skills are `/Users/anulman/.codex/skills/poteto-mode/`, `how/`, `technical-writing/`, `unslop/`, and `deslop/`.
Separate Before Serializing Shared State shaped the single-writer contract ownership and isolated checkout. Test Behavior, Not Implementation shaped PCM assertions and decoded-download checks instead of relying on attachment flags.
