# EliteDesk peripherals before live audio hosting

This plan prioritizes one working button, lamp, and knob for the operator's first wiring session. The shared C++ engine continues to decide musical behavior. A new portable peripheral module translates inputs and displays its decisions. Live audio-device hosting follows this milestone.

Status is proposed, with source inspection complete. No peripheral implementation, device connection, service startup, or physical verification has occurred. This plan follows the operator's [updated workstreams brief](https://github.com/anulman/show-tools/blob/main/docs/workstreams.md), which supersedes the audio-hosting-first order in [development.md](../development.md).

## Planning checklist

- [x] Read AGENTS.md, architecture.md, development.md, and the updated workstreams brief.
- [x] Inspect existing controls, clock ownership, light states, and repository inventory evidence.
- [x] Exchange command, clock, and light requirements with Performance Engine.
- [x] Define the first wiring demo and hardware-independent verification.
- [ ] Receive exact hardware facts and resolve electrical compatibility.
- [ ] Review this plan with the operator before implementation.

Throughput checkpoint. The planning milestone delivers this document only. The first implementation milestone produces a replayable simulated button-to-engine-to-lamp trace. Hardware selection and wiring do not block that simulation. Native audio backend selection does not belong on its critical path.

## Current behavior and missing hardware facts

[pf_control()](../../lib/performance/src/performance_engine.cpp) accepts the four pads, mushroom, and knob. Pad presses select a channel and resolve its current chart cue in C++. The knob sets the selected channel's gain between zero and one while preserving mute. Mushroom invokes Panic. Release has no engine action. The current [browser model](../../lib/performance/model.ts) uses `ChannelId` for L1, L2, R1, and R2. That legacy representation conflates button and channel identity. The operator clarified below that those names identify buttons, not voices. The keyboard layout is Q/W over A/S.

[pf_channel_info()](../../lib/performance/src/performance_engine.cpp) produces four light kinds. A pending stop on an active loop produces `releasing`. Active loops, pending actions, and capture otherwise produce `steady`. An unused supported cue produces `cue`. Other states produce `off`. These decisions remain in the performance engine. Mute currently does not change the native light kind.

The [browser appearance](../../ui/practice/style.css) uses a fixed 1.2-second cue pulse and a diminishing release animation. A beat-relative pulse is a proposed display improvement, not existing behavior. A physical release of a button and the native `releasing` light are different events.

The [native performance library](../../lib/performance/README.md) processes PCM and clock crossings without a device backend. The [relay](../../lib/relay/README.md) is optional, has no hardware producer, and is unused by WASM practice. Neither component supplies GPIO or lamp drivers.

Repository filename and content searches covered README.md, docs/, lib/, scripts/, ui/, and tracked or visible hardware-related filenames. No parts inventory or confirmed controller, pinout, electrical ratings, or device protocol was found. Software identifiers such as `mushroom` establish no physical component specification.

The operator must supply these hardware facts before a pin-level wiring sheet can be correct:

- The controller or USB interface model and revision, and EliteDesk operating system.
- The knob model and type, including encoder detents and push switch or potentiometer resistance and wiring.
- The arcade switch and lamp model or marked ratings, including separate switch contacts, lamp polarity, and lamp supply/current.
- The available power supply and driver parts, including any board that already provides current limiting, switching, or PWM.

Use those identifiers to inspect manufacturer documentation before selecting pins, resistors, drivers, or supply connections. This plan does not infer GPIO availability from the HP EliteDesk name.

## October 27 operator decisions

The operator's [timing review](https://github.com/anulman/show-tools/pull/1#discussion_r4384585331) requires at least 6/4, occasional short measures, quarter-, half-, and three-quarter-beat cue and capture positions, and instantaneous peripheral actions. The [tempo clarification](https://github.com/anulman/show-tools/pull/1#discussion_r4384945413) keeps a dominant meter with occasional short measures. It does not request arbitrary local meter changes. Chart-local BPM never changes clock BPM. The BPM pedal drives tempo changes.

The [manual-control decision](https://github.com/anulman/show-tools/pull/1#discussion_r4384853149) requires a press on an already-recorded voice to toggle playback immediately when no other action is sufficiently nearby. Performance Engine owns the proximity rule, tie ordering, and resulting action. The tolerance remains unresolved. Peripheral adapters send the press without choosing a chart action or guessing a tolerance.

The [lighting clarification](https://github.com/anulman/show-tools/pull/1#discussion_r4384919863) returns an expired scheduled light override to the current semantic state's normal pattern. The examples are playing solid, inactive off, and recording with a standard pulse. These requirements change the earlier preserve-recording-as-steady proposal. The hardware feedback watchdog remains a separate failure case.

The [logging decision](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380) applies to everything related to the performance engine. Debug runs use DEBUG, practice uses INFO, and performance uses WARN. The diagnostic trace described below is a debug artifact, not routine performance logging.

The [button-identity clarification](https://github.com/anulman/show-tools/pull/2#discussion_r4385154502) defines L1, L2, R1, and R2 as button IDs. Keep device/input identity, semantic button identity, and bound voice/resource/cue identity distinct. Performance Engine owns the program binding and its revision. The peripheral adapter reports a button activation, not a voice inferred from the button's name.

The [venue-tuning decision](https://github.com/anulman/show-tools/pull/2#discussion_r4385122810) places per-effect venue parameter adjustment in the web UI. No dedicated hardware tuning peripherals are introduced for those parameters. Existing performance knob mappings and the BPM pedal remain in scope. The [live-voice routing decision](https://github.com/anulman/show-tools/pull/2#discussion_r4385119436) requests processed voice in monitors, the room, and downloads when input and output devices differ, or when the same device is a USB audio interface. Filters and Performance Engine own that routing and device-policy implementation. This plan does not add a monitoring branch or infer audio topology from peripheral wiring.

These are target requirements. The current ABI and browser behavior described above do not already implement them. Performance Engine coordinates their shared representation before peripheral implementation.

## Portable control and light data

Propose `lib/peripherals/` for C++ normalization, light projection, native tests, simulated adapters, and device-specific adapters. Keep any browser controls or lamp preview under `ui/practice/`. New scripting uses TypeScript. Effect may manage device connection lifetime and external-data validation outside synchronous control projection and rendering. Read its installed AGENTS.md before writing Effect code.

The proposed data separates three things:

| Record | Meaning | Owner |
| --- | --- | --- |
| Physical input | Device session, input ID, sample sequence, device timestamp if available, host monotonic receipt time, and switch/absolute/delta value | Device adapter |
| Semantic command | Producer and command identity, sequence, current run/program identity, button or explicit semantic target, action, and timing policy | Performance Engine contract |
| Light snapshot | Engine session, epoch, run, program digest and binding revision, source sequence, source frame/rate, button ID, current semantic baseline, optional timed override, and projection revision | Performance Engine contract plus peripheral presentation |

Use separate variants for switch edges, absolute axes, and relative encoders. Validate packet framing, bounded lengths, finite values, and device identities at ingress. Derive semantic types from the coordinated schema rather than copying another command vocabulary. Device timestamps aid diagnostics and ordering within a device session. They are not audio-frame timestamps.

Foundational Thinking changes the order of work here. Agree on these records before device drivers, then exercise them in one simulated adapter. Sequence Work into Verifiable Units keeps the simulation, first physical circuit, and live-audio integration in separate verified commits.

## Turn controls into existing engine decisions

The portable C++ normalizer receives device samples and a monotonic timestamp supplied by the host. It does not open devices or generate beats. Its output uses the existing semantic controls through a small host binding.

For mechanical switches, propose a configurable 5 ms stable-state debounce as an initial test setting, with separate press and release latches. Measure actual bounce before adopting that setting for the identified switch. Each stable down edge emits one activation. Holding or repeated USB reports do not retrigger. Up clears the held latch and physical pressed indicator. It does not stop a sample or turn off a still-playing channel light.

Encoder transitions need their own valid-transition decoder and configured counts per detent. Do not apply a generic switch debounce that drops legitimate quadrature steps. Prefer decoded detents if the controller already supplies them. A potentiometer needs calibration, clamping, and a noise deadband based on its measured range. Neither type is assumed to exist yet.

The BPM pedal is a separate semantic input from the gain knob. Its exact hardware and gesture remain unconfirmed. Do not infer tap-tempo, an analog axis, a key mapping, or a pinout. Forward ordered pedal observations through the coordinated tempo command. Report the engine's actual effective frame and tempo revision. Loading a chart, moving into a bar with BPM metadata, or reconnecting a controller must not change clock BPM. Performance Engine defines initial tempo and the pedal gesture policy.

The first knob assignment remains the performance gain control. In the compatibility fixture this is selected-channel gain. In the target contract, Performance Engine resolves the selected button's binding to the intended voice or gain target, rather than treating the button ID as a voice ID. Absolute knobs use soft takeover after channel selection or reconnect, so a stale physical position does not jump gain. Relative encoders accumulate from the acknowledged gain. Knob push has no assignment until a push switch is confirmed. Cue-driven patch actions use the coordinated program binding. Per-effect venue tuning remains in the web UI and adds no dedicated hardware controls.

Preserve per-device input sequence. The host assigns a total command order when it accepts inputs from multiple producers. Coalesce high-rate absolute knob updates only between discrete commands. A knob update before a channel-selecting press must not move after it. Use a bounded queue with explicit overflow diagnostics. On overflow, discard pending ordinary input and require snapshot recovery and release rearming. Preserve an independent Panic request path so knob traffic cannot prevent a stop.

Device IO and network publication never touch the engine concurrently. One thread owns engine calls and copied state. `pf_process()` alone advances musical time. A command applies at its acknowledged engine boundary, and C++ chooses any quantized chart boundary. Do not backdate delayed physical presses to a guessed beat. Immediate commands must not wait for a beat, bar, or lamp refresh. Apply them at the earliest eligible engine boundary under the coordinated command policy. A mechanical debounce and device delivery still introduce latency. Trace those separately from musical quantization. For a button bound to a recorded voice with no sufficiently nearby cue, C++ resolves that binding and toggles playback immediately. The normalizer must neither convert that press into a quantized launch nor duplicate the engine's cue-proximity resolver.

Represent musical cue and capture positions using the shared exact fractional timing contract. Preserve quarter-, half-, and three-quarter-beat offsets without rounding to whole beats. Feedback supplies explicit meter, measure boundaries, and beat units. Do not assume four beats per measure in input mapping, release deadlines, pulse anchoring, or fixtures. Any current four-beat engine restriction needs a coordinated engine change before the new timing cases can pass.

There is a preparation constraint before live audio. `pf_control()` can reach `st_prepare()` through capture actions and allocate. The offline demo can alternate command preparation and block processing on one thread. A production callback must not drain arbitrary pad commands under a realtime-safe claim. Coordinate preparation or preallocation with Performance Engine before a device-host milestone. Reset and configuration also remain outside live processing.

## Drive lamps from clock and state

The portable light projector takes a snapshot and an explicit presentation frame and returns bounded brightness for each button lamp. Performance Engine supplies the resolved button feedback from current bindings and semantic state. The projector must not assume that a button and voice share an ID or invent aggregation rules for multiple bound resources. The same C++ function compiles natively and to WASM. It does not resolve cues, launch samples, or advance engine time.

Separate the current semantic baseline from a temporary display override. The operator confirmed playing solid, inactive off, and recording with a standard pulse as baseline examples. Performance Engine must settle the canonical recording waveform, armed and stopping states, cue indication, override priority, and interaction with simultaneous capture and playback. Do not infer those rules from the old `steady` flag or implement independent hardware precedence.

The earlier one-pulse-per-beat cue proposal and the browser's release keyframe curve remain display candidates for coordinated review. They do not override the operator's recording-pulse requirement. Any adopted beat-relative pattern consumes the engine's declared beat unit and anchor rather than a hard-coded 4/4 cycle.

A timed override carries its ID/revision, pattern, and start and expiry frames. At expiry, recompute the baseline from the latest semantic state. Do not restore the state captured when the override began, and do not unconditionally turn the lamp off. If recording begins during an override, expiry reveals the recording pulse. If playback stops during it, expiry reveals inactive off. A release animation ending at a stop boundary reaches zero only when the resulting current baseline is inactive. Repeated snapshots of the same override must not restart it.

A physical button release only clears the held latch. A light override expiry changes presentation. A queued musical stop changes playback through C++. None of these events substitutes for another.

The shared schema needs current semantic state, timed override identity and interval, release start and deadline where applicable, beat unit and anchor, tempo/phase revision, and clock discontinuity information. The current ABI provides remaining release milliseconds and clock/frame state, not this complete contract. Until the coordinated change lands, fixtures may derive a provisional deadline from a captured frame, rate, and remaining duration. Do not present that approximation as a new authoritative ABI.

Propose a host output cadence of 60 Hz with a full refresh at 10 Hz and changed-value writes between refreshes. These are starting targets, not measured hardware capabilities. The device capability handshake determines supported PWM resolution, binary-only output, maximum update rate, channel mapping, and watchdog support. Clamp and quantize in the device adapter. A binary lamp uses a documented threshold and loses smooth dimming. PWM frequency belongs to the identified controller/driver, independently of the host update cadence.

Interpolate presentation only from a recent engine anchor and host-to-engine calibration. Audio continues independently if presentation stalls. On tempo revision, seek, restart, loop discontinuity, or epoch change, consume the new anchor and invalidate older output. Never use event receipt time as the beat. Stop extrapolating when the feedback lease expires.

For lost device feedback, retain the proposed 500 ms output lease with all lamps dark after expiry. This connectivity timeout is distinct from a scheduled light override returning to its current semantic baseline. A controller-side watchdog is needed to enforce darkness if the USB cable or host process disappears. If the identified hardware cannot enforce that, document the limitation rather than claiming fail-dark behavior. Device disconnection does not stop engine audio automatically.

## Command identity and reconnection

Performance Engine coordinates the shared contracts. Its October 26 proposal separates a versioned semantic JSON schema from the PF binary ABI. Commands carry `producerId`, `commandId`, `producerSequence`, `runId`, expected `programDigest`, action, target, and timing. The host orders accepted commands. Native results identify applied frame, epoch, and result.

Feedback proposes `engineSessionId`, epoch, run, program digest, source sequence, audio frame and sample rate, musical position, loop iteration, tempo/phase, semantic baseline and light override state, explicit meter and beat unit, discontinuity reason, and dropped-event count. Peripherals requested release and override start/expiry frames and revision, plus beat anchors for presentation. The October 27 timing decisions also require immediate controls, exact fractional positions, and pedal-driven tempo revisions without chart-BPM side effects. These are coordinated proposals, not implemented fields. No shared header or bridge changes belong to this planning commit.

Current native command deduplication retains 256 successful controls. IDs are at most 200 UTF-16 code units. Current control events do not include command ID or an explicit applied-frame acknowledgment. The existing bridge correlates events. Do not claim exactly-once delivery across cache eviction, process restart, or reconnect.

On a fresh device connection, obtain capabilities and a current engine snapshot before enabling output. Create a fresh device-session identity. A switch held at connection remains disarmed until a release. Clear pending inputs on disconnect. Do not replay offline presses or unresolved toggles. Resume lamps from the latest snapshot, and rearm an absolute knob through soft takeover. Sequence gaps and telemetry overflow trigger a snapshot refresh. Ignore stale snapshots and replies from previous engine/device sessions.

## Native and browser adapters

Prefer the identified controller's supported bidirectional protocol. USB serial is a candidate when that controller exposes it. HID reports are another candidate if documented output reports can control lamps. A keyboard-emulating encoder supplies input, but it does not establish a general lamp-output path. A GPIO expander or other device needs its own host adapter and verified electrical interface. No controller or dependency is selected by this plan.

On EliteDesk, the host adapter owns device open/close, byte/report parsing, IO errors, and output writes. The web UI can run on another machine. The native engine and local peripheral path do not need a browser connection to keep processing. A future server carries semantic controls and observations. Its arrival timestamps do not schedule music.

Browser WASM accesses hardware through imported host functions and browser APIs. It cannot directly operate GPIO. The [WebAssembly FAQ](https://webassembly.org/docs/faq/index.html) describes browser access through the same browser APIs available to JavaScript. Device access stays in a TypeScript adapter outside the audio worklet.

[Web Serial](https://developer.chrome.com/docs/capabilities/serial) offers bidirectional serial access in supported browsers. It needs a secure context and a user gesture for the initial chooser. [WebHID](https://developer.chrome.com/docs/capabilities/hid) uses device-specific reports and restricts protected usages. [WebUSB](https://developer.chrome.com/docs/capabilities/usb) requires compatible interfaces and browser permission. These APIs have different browser and platform support. Feature-detect the exact API and test the actual device. Do not promise a physical-device route on all phones or browsers.

A browser adapter can feed the portable normalizer and forward commands over the existing local WASM bridge. It receives snapshots and projects lamps through the same C++ logic. Selecting a compatible device is an explicit browser interaction. Browser permission, background throttling, USB loss, and page closure remain adapter lifecycle cases. WASM practice without physical devices remains a static application with no relay requirement.

Prefer existing OS APIs and permissive libraries. Check the exact selected native driver and firmware licenses before adoption. This plan introduces no dependency. No aubio follower or its GPL dependency is needed for peripheral simulation.

## First useful wiring demo

The first circuit uses one confirmed button switch, its separately controlled lamp, and one confirmed knob. Assign the physical switch to button R1 and bind that button explicitly to fixture voice `demo-voice`. Other buttons remain simulated. A compatibility adapter may translate that binding to the existing native channel slot, without making the slot number or R1 the voice identity. Add the remaining three buttons and mushroom only after the first circuit passes.

The topology is fixed at the role level. Switch contacts connect to a documented digital input and reference through the input circuit specified for that controller. The knob connects to documented encoder inputs or an ADC circuit, depending on its actual type. The lamp connects to a rated lamp supply through the confirmed output driver. Signal reference, isolation, current limiting, and protection follow those parts' datasheets. Bare GPIO is not presumed capable of driving the lamp.

After receiving part identifiers, the next wiring artifact is a terminal-to-terminal sheet with each connector, voltage, polarity, resistor or driver, and power source. Until then, there is no valid numbered pin diagram. Begin with the switch-only input circuit. Confirm its trace before powering a lamp circuit. Confirm lamp off/on and watchdog behavior before connecting engine-driven animation.

For the software demo, load a small synthetic native program with `rb`, `cb`, and `xb` cues bound from button R1 to `demo-voice`. Use generated PCM rather than a microphone. Run the existing engine with an explicit offline block pump and discarded audio output. Device reports feed the same normalized control path used by the simulator. This demonstrates real engine decisions without choosing an audio-device backend or running a service.

The expected operator sequence is concrete:

1. Start the offline fixture. R1 shows a beat-relative cue pulse.
2. Press and hold the button. Exactly one R1 command arms capture. Display the coordinated armed state, then the standard recording pulse when capture begins.
3. Release the button. The held indicator clears while the lamp continues the current armed or recording pattern.
4. In the commit cue, press again. Commit occurs at the native bar boundary and playback starts. The lamp stays steady.
5. Turn the knob after takeover. Acknowledged gain for the resolved `demo-voice` target changes while timing and mute remain intact.
6. At the queued-stop cue, press again. The lamp releases to zero at the native stop boundary.
7. Inject a scheduled lamp override while recording, then let it expire. The recording pulse resumes. Repeat while playing and while inactive to verify solid on and off respectively.
8. At a location outside the agreed cue-proximity window, press the button bound to a recorded voice to toggle playback immediately. This step depends on Performance Engine resolving that window.
9. Exercise Panic through the simulated control, then disconnect the device. No stale press replays when reconnected. Verify the lamp watchdog separately from scheduled-override expiry.

The current-engine fixture first covers existing `rb`, `cb`, and `xb` behavior. Target recording pulse, timed overrides, immediate toggle fallback, variable measures, and fractional timing enter the fixture with the coordinated engine contract changes. Do not mark these target cases passed using the current four-beat implementation. Inject BPM-pedal input in simulation until the physical pedal and its gesture are identified.

This proves controls and feedback on the identified circuit only after it runs physically. The offline fixture does not prove audio-device latency, microphone quality, lamp current margins, or reliable performance under an operating-system audio callback.

## Simulated verification and implementation phases

Phase 1 implements the portable normalizer/projector plus a fake-clock device adapter under `lib/peripherals/`. Compile the same core natively and to WASM. Run an offline fixture against the actual performance library with cleared output buffers, synthetic PCM, and one engine owner. In DEBUG runs, emit a machine-readable trace of raw input, accepted command, native result, engine frame, light state, and quantized brightness. A TypeScript comparison tool checks native and WASM traces. Proposed commands and filenames are introduced in that milestone, not represented here as runnable tools.

Verify observable behavior with these cases:

- Contact bounce, held reports, and release produce exactly one activation per stable press. A held reconnect produces no activation.
- Clock crossings inside different block sizes produce the same capture, commit, playback, and stop frames. Include a 6/4 dominant meter and an explicitly short measure using the shared meter representation.
- Quarter-, half-, and three-quarter-beat cue and capture offsets preserve their resolved frames. Immediate pad actions do not wait for a beat crossing or lamp output tick.
- A button bound to a recorded voice toggles that voice immediately outside the agreed cue-proximity window. Exercise the exact window boundary, overlapping cues, and precedence once Performance Engine specifies that policy.
- Chart-local BPM changes, chart load, and reconnect leave clock BPM unchanged. An accepted BPM-pedal command changes tempo at its acknowledged frame and refreshes pulse anchors.
- Rebind the same button to a different fixture voice. The command retains button identity, the engine resolves the new voice target, and lamp feedback follows the current binding revision. Reject or refresh stale binding feedback through the coordinated contract.
- A target-selecting button press between knob values preserves resolved target order. Absolute reconnect takeover prevents gain jumps. Invalid knob values are rejected at ingress.
- Adopted pulse patterns match engine beat anchors and beat units. Playing solid, inactive off, and the agreed recording pulse are verified baselines. Override expiry reveals the latest baseline after transitions during the override. Duplicate snapshots do not restart it. Test the separate connectivity timeout and queued-stop release deadline.
- Tempo revisions, loop wraps, new runs, epoch changes, and stale snapshots invalidate old projection. Include feedback gaps and dropped-event recovery.
- Knob floods cannot block Panic. Queue overflow causes explicit recovery. Replayed IDs do not duplicate controls within the supported dedup window.
- Simulated disconnects cancel pending IO, clear physical latches, stop output after the lease, and recover from the current snapshot.
- Native and WASM core outputs agree on fixed input/frame fixtures. Quantized lamp levels match exactly. Separate any floating-point comparison tolerance from command/frame identity.

Apply one engine-wide logging profile across the peripheral core, adapters, host queues, and observers. DEBUG allows detailed traces and artifacts, INFO is the practice threshold, and WARN is the performance threshold. Filter before expensive formatting or artifact creation. Keep essential acknowledgments and state feedback as functional protocol data regardless of logging level. Counters and bounded diagnostic records can cross to an observer, but no logging sink or file IO runs in the audio callback. Verify that INFO omits debug traces and WARN omits DEBUG and INFO records across all peripheral-related components.

Phase 2 adds one device adapter after hardware identification. Verify parsing with recorded packets before real IO. Then execute the first circuit's input, lamp, knob, and reconnect checks. Record actual switch debounce, output rate, watchdog behavior, and latency. Label each result as physical or simulated. Commit the adapter, terminal sheet, and verification evidence together without bulk temporary traces.

Phase 3 expands to four pads and the confirmed Panic control. Preserve semantic light state independently of button hold. Add only confirmed extra inputs. Coordinate cue-driven patch actions and button-to-resource bindings with Filters and Performance Engine. Keep per-effect venue parameter tuning in the web UI without dedicated hardware peripherals. Verify mixed-producer ordering and repeated reconnects.

Phase 4 adds production native audio hosting and the compiled-song loader. Resolve allocating control paths first. Audit command queues, callback ownership, device buffers, deadlines, and underruns on the real EliteDesk. Hardware IO, serialization, file loading, and publishing stay outside the callback. Update architecture.md and development.md when these ownership boundaries become implemented behavior.

Each phase ends with relevant native CMake tests, native/WASM conformance, and a focused diff check before its milestone commit. C++ or ABI changes require regenerated ABI sources and both builds. Shared changes also run repository typecheck, tests, and layout checks. Physical checks remain distinct from fixture success.

## Planning verification and pending decisions

Planning verification inspected the existing implementation and checked document links and diff whitespace. No compile or runtime checks are claimed for a documentation-only milestone. No files outside this plan are changed. No services, audio devices, controller IO, or firmware flashing are started.

The hardware questions above are the only facts needed from the operator to choose the first circuit. The first compatibility fixture uses existing pad actions and selected-channel gain. Target behavior follows the October 27 immediate-control, timing, pedal, baseline-light, and logging decisions. Beat-relative pulsing and the proposed timeout values are recommendations for plan review. They do not change existing browser behavior in this milestone.

The cue-proximity tolerance, initial-tempo and pedal gesture policy, recording pulse waveform, and light override priorities remain subject to Performance Engine's coordinated contract milestone. They are not hardware facts and must not be guessed by this adapter plan. Shared command and light fields remain subject to that same milestone. The next action after plan review is the simulated C++ milestone, followed by the terminal sheet once the parts are identified.
