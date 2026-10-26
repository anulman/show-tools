# EliteDesk peripherals before live audio hosting

This plan prioritizes one working button, lamp, and knob for the operator's October 26 wiring session. The shared C++ engine continues to decide musical behavior. A new portable peripheral module translates inputs and displays its decisions. Live audio-device hosting follows this milestone.

Status is proposed, with source inspection complete. No peripheral implementation, device connection, service startup, or physical verification has occurred. This plan follows the operator's [updated workstreams brief](/Users/anulman/dev/show-tools/docs/workstreams.md), which supersedes the audio-hosting-first order in [development.md](../development.md).

## Planning checklist

- [x] Read AGENTS.md, architecture.md, development.md, and the updated workstreams brief.
- [x] Inspect existing controls, clock ownership, light states, and repository inventory evidence.
- [x] Exchange command, clock, and light requirements with Performance Engine.
- [x] Define the first wiring demo and hardware-independent verification.
- [ ] Receive exact hardware facts and resolve electrical compatibility.
- [ ] Review this plan with the operator before implementation.

Throughput checkpoint. The planning milestone delivers this document only. The first implementation milestone produces a replayable simulated button-to-engine-to-lamp trace. Hardware selection and wiring do not block that simulation. Native audio backend selection does not belong on its critical path.

## Current behavior and missing hardware facts

[pf_control()](../../lib/performance/src/performance_engine.cpp) accepts the four pads, mushroom, and knob. Pad presses select a channel and resolve its current chart cue in C++. The knob sets the selected channel's gain between zero and one while preserving mute. Mushroom invokes Panic. Release has no engine action. The [browser model](../../lib/performance/model.ts) names the channels L1, L2, R1, and R2. The keyboard layout is Q/W over A/S.

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

## Portable control and light data

Propose `lib/peripherals/` for C++ normalization, light projection, native tests, simulated adapters, and device-specific adapters. Keep any browser controls or lamp preview under `ui/practice/`. New scripting uses TypeScript. Effect may manage device connection lifetime and external-data validation outside synchronous control projection and rendering. Read its installed AGENTS.md before writing Effect code.

The proposed data separates three things:

| Record | Meaning | Owner |
| --- | --- | --- |
| Physical input | Device session, input ID, sample sequence, device timestamp if available, host monotonic receipt time, and switch/absolute/delta value | Device adapter |
| Semantic command | Producer and command identity, sequence, current run/program identity, target, action, and timing policy | Performance Engine contract |
| Light snapshot | Engine session, epoch, run, program digest, source sequence, source frame/rate, channel light kind, release interval, and projection revision | Engine plus peripheral presentation |

Use separate variants for switch edges, absolute axes, and relative encoders. Validate packet framing, bounded lengths, finite values, and device identities at ingress. Derive semantic types from the coordinated schema rather than copying another command vocabulary. Device timestamps aid diagnostics and ordering within a device session. They are not audio-frame timestamps.

Foundational Thinking changes the order of work here. Agree on these records before device drivers, then exercise them in one simulated adapter. Sequence Work into Verifiable Units keeps the simulation, first physical circuit, and live-audio integration in separate verified commits.

## Turn controls into existing engine decisions

The portable C++ normalizer receives device samples and a monotonic timestamp supplied by the host. It does not open devices or generate beats. Its output uses the existing semantic controls through a small host binding.

For mechanical switches, propose a configurable 5 ms stable-state debounce as an initial test setting, with separate press and release latches. Measure actual bounce before adopting that setting for the identified switch. Each stable down edge emits one activation. Holding or repeated USB reports do not retrigger. Up clears the held latch and physical pressed indicator. It does not stop a sample or turn off a still-playing channel light.

Encoder transitions need their own valid-transition decoder and configured counts per detent. Do not apply a generic switch debounce that drops legitimate quadrature steps. Prefer decoded detents if the controller already supplies them. A potentiometer needs calibration, clamping, and a noise deadband based on its measured range. Neither type is assumed to exist yet.

The first knob assignment remains selected-channel gain. A pad selects its channel as today. Absolute knobs use soft takeover after channel selection or reconnect, so a stale physical position does not jump gain. Relative encoders accumulate from the acknowledged gain. Knob push has no assignment until a push switch is confirmed. Patch assignment waits for the coordinated patch contract.

Preserve per-device input sequence. The host assigns a total command order when it accepts inputs from multiple producers. Coalesce high-rate absolute knob updates only between discrete commands. A knob update before a channel-selecting press must not move after it. Use a bounded queue with explicit overflow diagnostics. On overflow, discard pending ordinary input and require snapshot recovery and release rearming. Preserve an independent Panic request path so knob traffic cannot prevent a stop.

Device IO and network publication never touch the engine concurrently. One thread owns engine calls and copied state. `pf_process()` alone advances musical time. A command applies at its acknowledged engine boundary, and C++ chooses any quantized chart boundary. Do not backdate delayed physical presses to a guessed beat.

There is a preparation constraint before live audio. `pf_control()` can reach `st_prepare()` through capture actions and allocate. The offline demo can alternate command preparation and block processing on one thread. A production callback must not drain arbitrary pad commands under a realtime-safe claim. Coordinate preparation or preallocation with Performance Engine before a device-host milestone. Reset and configuration also remain outside live processing.

## Drive lamps from clock and state

The portable light projector takes a snapshot and an explicit presentation frame and returns bounded brightness for each channel. The same C++ function compiles natively and to WASM. It does not resolve cues, launch samples, or advance engine time.

Propose these hardware display rules:

| Native kind | Physical lamp behavior |
| --- | --- |
| `off` | Zero brightness |
| `cue` | One smooth pulse per engine beat, ranging from 25% to 100%, with the peak at the beat anchor |
| `steady` | Full brightness while the native state persists |
| `releasing` | Diminishing pulses over the engine release interval, then zero at the deadline |

Use the browser's existing release keyframe fractions and brightness peaks as the initial shared release curve. Compute normalized progress from release start and deadline frames. An update to the same release revision must not restart the fade. An engine state transition overrides the animation. Stop and Panic clear active output according to engine state. A supported unused cue may subsequently reappear according to the engine's existing rules.

The shared schema needs release start and deadline, beat anchor, tempo/phase revision, and clock discontinuity information. The current ABI provides remaining release milliseconds and clock/frame state, not this complete contract. Until the coordinated change lands, fixtures may derive a provisional deadline from a captured frame, rate, and remaining duration. Do not present that approximation as a new authoritative ABI.

Propose a host output cadence of 60 Hz with a full refresh at 10 Hz and changed-value writes between refreshes. These are starting targets, not measured hardware capabilities. The device capability handshake determines supported PWM resolution, binary-only output, maximum update rate, channel mapping, and watchdog support. Clamp and quantize in the device adapter. A binary lamp uses a documented threshold and loses smooth dimming. PWM frequency belongs to the identified controller/driver, independently of the host update cadence.

Interpolate presentation only from a recent engine anchor and host-to-engine calibration. Audio continues independently if presentation stalls. On tempo revision, seek, restart, loop discontinuity, or epoch change, consume the new anchor and invalidate older output. Never use event receipt time as the beat. Stop extrapolating when the feedback lease expires.

Propose a 500 ms output lease with all lamps dark after expiry. A controller-side watchdog is needed to enforce darkness if the USB cable or host process disappears. If the identified hardware cannot enforce that, document the limitation rather than claiming fail-dark behavior. Device disconnection does not stop engine audio automatically.

## Command identity and reconnection

Performance Engine coordinates the shared contracts. Its October 26 proposal separates a versioned semantic JSON schema from the PF binary ABI. Commands carry `producerId`, `commandId`, `producerSequence`, `runId`, expected `programDigest`, action, target, and timing. The host orders accepted commands. Native results identify applied frame, epoch, and result.

Feedback proposes `engineSessionId`, epoch, run, program digest, source sequence, audio frame and sample rate, musical position, loop iteration, tempo/phase, light state, discontinuity reason, and dropped-event count. Peripherals requested release start/deadline frames and revision, plus beat anchors for presentation. These are coordinated proposals, not implemented fields. No shared header or bridge changes belong to this planning commit.

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

The first circuit uses one confirmed button switch, its separately controlled lamp, and one confirmed knob. Assign the button to R1. Other channels remain simulated. Add the remaining three buttons and mushroom only after the first circuit passes.

The topology is fixed at the role level. Switch contacts connect to a documented digital input and reference through the input circuit specified for that controller. The knob connects to documented encoder inputs or an ADC circuit, depending on its actual type. The lamp connects to a rated lamp supply through the confirmed output driver. Signal reference, isolation, current limiting, and protection follow those parts' datasheets. Bare GPIO is not presumed capable of driving the lamp.

After receiving part identifiers, the next wiring artifact is a terminal-to-terminal sheet with each connector, voltage, polarity, resistor or driver, and power source. Until then, there is no valid numbered pin diagram. Begin with the switch-only input circuit. Confirm its trace before powering a lamp circuit. Confirm lamp off/on and watchdog behavior before connecting engine-driven animation.

For the software demo, load a small synthetic native program with R1 cues for `rb`, `cb`, and `xb`. Use generated PCM rather than a microphone. Run the existing engine with an explicit offline block pump and discarded audio output. Device reports feed the same normalized control path used by the simulator. This demonstrates real engine decisions without choosing an audio-device backend or running a service.

The expected operator sequence is concrete:

1. Start the offline fixture. R1 shows a beat-relative cue pulse.
2. Press and hold the button. Exactly one R1 command arms capture. The lamp becomes steady.
3. Release the button. The held indicator clears while the lamp retains native armed or capture state.
4. In the commit cue, press again. Commit occurs at the native bar boundary and playback starts. The lamp stays steady.
5. Turn the knob after takeover. Acknowledged R1 gain changes while timing and mute remain intact.
6. At the queued-stop cue, press again. The lamp releases to zero at the native stop boundary.
7. Exercise Panic through the simulated control, then disconnect the device. No stale press replays when reconnected. Verify the lamp watchdog separately from engine state.

This proves controls and feedback on the identified circuit only after it runs physically. The offline fixture does not prove audio-device latency, microphone quality, lamp current margins, or reliable performance under an operating-system audio callback.

## Simulated verification and implementation phases

Phase 1 implements the portable normalizer/projector plus a fake-clock device adapter under `lib/peripherals/`. Compile the same core natively and to WASM. Run an offline fixture against the actual performance library with cleared output buffers, synthetic PCM, and one engine owner. Emit a machine-readable trace of raw input, accepted command, native result, engine frame, light state, and quantized brightness. A TypeScript comparison tool checks native and WASM traces. Proposed commands and filenames are introduced in that milestone, not represented here as runnable tools.

Verify observable behavior with these cases:

- Contact bounce, held reports, and release produce exactly one activation per stable press. A held reconnect produces no activation.
- Clock crossings inside different block sizes produce the same capture, commit, playback, and stop frames.
- A channel-selecting press between knob values preserves target order. Absolute reconnect takeover prevents gain jumps. Invalid knob values are rejected at ingress.
- Cue pulse peaks match engine beat anchors. Steady and off are exact endpoints. Repeated release snapshots do not restart fading. Release ends at its deadline.
- Tempo revisions, loop wraps, new runs, epoch changes, and stale snapshots invalidate old projection. Include feedback gaps and dropped-event recovery.
- Knob floods cannot block Panic. Queue overflow causes explicit recovery. Replayed IDs do not duplicate controls within the supported dedup window.
- Simulated disconnects cancel pending IO, clear physical latches, stop output after the lease, and recover from the current snapshot.
- Native and WASM core outputs agree on fixed input/frame fixtures. Quantized lamp levels match exactly. Separate any floating-point comparison tolerance from command/frame identity.

Phase 2 adds one device adapter after hardware identification. Verify parsing with recorded packets before real IO. Then execute the first circuit's input, lamp, knob, and reconnect checks. Record actual switch debounce, output rate, watchdog behavior, and latency. Label each result as physical or simulated. Commit the adapter, terminal sheet, and verification evidence together without bulk temporary traces.

Phase 3 expands to four pads and the confirmed Panic control. Preserve semantic light state independently of button hold. Add only confirmed extra inputs. Coordinate patch parameter mappings with Filters and Performance Engine. Verify mixed-producer ordering and repeated reconnects.

Phase 4 adds production native audio hosting and the compiled-song loader. Resolve allocating control paths first. Audit command queues, callback ownership, device buffers, deadlines, and underruns on the real EliteDesk. Hardware IO, serialization, file loading, and publishing stay outside the callback. Update architecture.md and development.md when these ownership boundaries become implemented behavior.

Each phase ends with relevant native CMake tests, native/WASM conformance, and a focused diff check before its milestone commit. C++ or ABI changes require regenerated ABI sources and both builds. Shared changes also run repository typecheck, tests, and layout checks. Physical checks remain distinct from fixture success.

## Planning verification and pending decisions

Planning verification inspected the existing implementation and checked document links and diff whitespace. No compile or runtime checks are claimed for a documentation-only milestone. No files outside this plan are changed. No services, audio devices, controller IO, or firmware flashing are started.

The hardware questions above are the only facts needed from the operator to choose the first circuit. The recommended initial behavior uses existing pad actions, selected-channel gain, and native light kinds. Beat-relative pulsing and the proposed timeout values are recommendations for plan review. They do not change existing browser behavior in this milestone.

Shared command and light fields remain subject to Performance Engine's coordinated contract milestone. The next action after plan review is the simulated C++ milestone, followed by the terminal sheet once the parts are identified.
