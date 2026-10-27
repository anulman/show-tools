# EliteDesk peripheral harness and shared button lighting

Build the complete arrived control harness around the I-PAC Ultimate I/O. Deliver keyboard button events, SpinTrak direction and distance, and engine-driven arcade-button LEDs. The same light semantics appear on the browser pads. Song programs determine what controls do. Native audio-device hosting follows this work.

This is the corrected plan for [PR #3](https://github.com/anulman/show-tools/pull/3). It incorporates all ten operator review comments and replaces the earlier generic-controller and fixed-gain design. Only the specific unanswered choices identified below remain open. This milestone changes documentation, with no implementation, firmware change, service startup, or hardware IO.

## Complete arrived hardware

The repository record is `docs/hardware-inventory.md` in the operator checkout. The operator supplied the [parts inventory](https://github.com/anulman/show-tools/pull/3#discussion_r4385787375) and confirmed that [all components have arrived](https://github.com/anulman/show-tools/pull/3#discussion_r4385950356). The harness scope is the complete set, not a one-button subset.

| Part | Quantity and confirmed configuration |
| --- | --- |
| Illuminated arcade buttons | Four 100 mm buttons in the [Adafruit #1185 family](https://www.adafruit.com/product/1185), with LEDs inside the buttons |
| Foot pedal | One momentary [Adafruit #423](https://www.adafruit.com/product/423), with a 2 m cable, for BPM tapping |
| Mushroom button | One red momentary [Addison NPB22-M611R](https://addison-electronique.com/en/momentary-push-button-switch-mushroom-head-n-o-n-c-red.html), using its normally open contact |
| Rotary control | One [SpinTrak](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/), connected directly to I-PAC without the separate USB interface |
| Controller | One [I-PAC Ultimate I/O](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/), 4.8 mm switch-harness variant |

I-PAC is the input and LED controller. No additional Arduino is part of this plan. Ultimarc documents keyboard/mouse/LED operation, direct spinner connection, board-side switch debounce, and an LED-control SDK. Its spinner configuration selects an X, Y, or Z mouse axis. These are manufacturer capabilities, not a claim about the current board configuration. [I-PAC documentation](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

Adafruit documents normally open arcade switches, LED inserts with built-in resistors, 4.8 mm switch terminals, and 6.3 mm LED terminals. The supplied LED can operate up to 12 V, which does not select this harness's supply voltage. The 4.8 mm switch harness does not identify the separate LED connections. [Button specifications](https://www.adafruit.com/product/1185)

## Harness preparation and wiring acceptance

Prepare a terminal schedule for all four button switches and their LEDs, the pedal, mushroom normally open contact, and direct SpinTrak connector. Each entry records the physical control, connector label, I-PAC input or LED channel, and polarity where applicable. Read the board markings and actual configuration before assigning numbered terminals. Verify each completed circuit before powering the complete harness. Individual circuit checks do not reduce the deliverable to one button.

The switch circuits follow I-PAC's documented switch-to-input and ground arrangement. Use the direct SpinTrak connection documented for Ultimate I/O rather than the separate USB-version wiring or an Opti-PAC pinout. LED wiring follows the actual insert, harness, polarity, and selected supply. Ultimarc documents separate LED power and single-color LED harness requirements. [I-PAC installation](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

The remaining wiring question is specific. Which LED connector harness and power source are present, and are the supplied Adafruit LED inserts still installed? Confirm those details before completing the LED terminal schedule or selecting its supply. The inventory and full-harness scope are already settled.

The first physical acceptance demonstrates every switch's press and release, pedal edges, positive and negative SpinTrak motion with distance, and independent control of all four button LEDs. Record the actual keycodes, axis, direction convention, and LED channel mapping. Do not assign a musical purpose to the mushroom or four buttons based on their shape, location, or current UI defaults.

## Input identity and song-specific decisions

Switches enter the software as keyboard press and release events. Ignore keyboard auto-repeat for a held switch and track release so a hold produces one activation. Do not add a guessed mechanical debounce delay on top of I-PAC's debounce. Preserve the board's configured behavior until a switch trace justifies changing it. Release clears the physical held state. Musical actions remain program-defined.

SpinTrak input is direction plus distance. Preserve signed movement and event order without converting it to an absolute zero-to-one gain value. Do not assume a potentiometer, detents, push switch, gain accumulation, or soft takeover. Its interpretation can differ between songs. The compiler and C++ performance engine own those bindings. Per-effect venue parameters remain in the web UI, with no dedicated tuning peripherals. [Knob correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385870592), [venue controls](https://github.com/anulman/show-tools/pull/2#discussion_r4385122810)

Keep physical input identity, stable semantic button identity, display label, and bound voice/resource/cue identity separate. Labels may become Red, Blue, Yellow, and Green and remain consistent across songs. Do not encode musical meaning in the strings L1, L2, R1, or R2. A song maps the stable controls to its own actions. [Button labels](https://github.com/anulman/show-tools/pull/3#discussion_r4385841828), [buttons versus voices](https://github.com/anulman/show-tools/pull/2#discussion_r4385154502)

Preserve input order across button presses, pedal taps, and rotary movement. Do not discard rotary distance or merge it across a song-binding change. Performance Engine defines command identity, ordering, binding revisions, acknowledgment, and recovery. A browser keyboard event need not identify a specific physical USB device, so do not fabricate that identity in the portable record.

The engine resolves a button's bound action at the accepted engine position. Immediate actions must not wait for the next beat or LED refresh. For a button bound to a recorded voice, the operator requires immediate playback toggling when no action is sufficiently nearby. The cue-proximity tolerance remains a question for Performance Engine. It blocks that resolver policy, not keyboard input or harness work. [Manual playback decision](https://github.com/anulman/show-tools/pull/1#discussion_r4384853149)

## Confirmed pedal and musical time

The dominant 6/8 convention counts `1 2 3 4 5 6` in eighth-note beats. The BPM pedal taps those same eighth notes. Tapping can begin on any beat. The first tap must not establish beat 1, infer a downbeat, or reset bar phase, epoch, or loop iteration. Chart-local BPM never changes clock BPM. Tempo input remains separate from the knob's song bindings. [6/8 correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385809988), [pedal tempo ownership](https://github.com/anulman/show-tools/pull/1#discussion_r4384945413). The count and permission to begin on any beat were subsequently confirmed by the operator through project coordination.

Preserve occasional short measures and quarter-, half-, and three-quarter-beat cue and capture positions through the shared exact timing contract. Performance Engine owns beat units, continuous position, effective tempo frames, and native/WASM ABI changes. Tap-estimation policies such as observation count, outlier handling, gaps, and smoothing remain unspecified. Do not invent them or treat a tempo estimate as downbeat detection.

## One set of light semantics for LEDs and browser pads

The physical lights are the LEDs inside the four arcade buttons. Browser pads display the same lit, pulse, blink, and transient states. Shared C++ defines the semantic light state and time-based pattern for both native execution and WASM. The hardware adapter delivers LED output; the browser consumer draws its pad. Neither consumer decides which musical action occurred. [LED correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385885145), [browser parity](https://github.com/anulman/show-tools/pull/3#discussion_r4385891058)

| Situation | Confirmed light behavior |
| --- | --- |
| Playing | Solid on as the normal state |
| Inactive | Off as the normal state |
| Pending action | Pulse or blink, distinct from recording |
| Recording | The other of pulse and blink |
| Successful one-shot trigger | Rapid rise, brief hold, then decay |
| Timed override expires | Recompute the current semantic state's normal pattern |

The [latest pending/recording and one-shot instruction](https://github.com/anulman/show-tools/pull/3#discussion_r4385792568) supersedes recording-as-steady and any assumed fixed recording pattern. At override expiry, restore the current normal state, not the state captured before the override. A one-shot during playback therefore returns to playing solid when the override ends. A transition during the override changes that destination. [Expiry behavior](https://github.com/anulman/show-tools/pull/1#discussion_r4384919863)

The questions beside this contract are specific. Should pending actions blink while recording pulses, or the reverse? What are the pattern and one-shot rise/hold/decay timings, in fixed time or beat fractions? What takes priority when recording, pending actions, and one-shot feedback overlap? Those answers block final pattern constants and overlap policy. They do not block representing the distinct states, writing consumer-independent fixtures, or documenting their transitions.

Output follows each peripheral's cadence. Smooth raw values in the consuming LED adapter or browser renderer using the shared pattern and engine-time anchors. The consumers may have different update intervals while preserving equivalent visible state and pattern progress. Do not impose a global output frequency, refresh frequency, watchdog interval, or device capability handshake that has not been established for this board. [Cadence decision](https://github.com/anulman/show-tools/pull/3#discussion_r4385914670)

Ultimarc documents brightness control and onboard fades. Use only the actual firmware and host interface's established capabilities. A repeated snapshot must not restart an override. Tempo changes and discontinuities update presentation anchors; receipt time does not become the musical clock. Test the board's actual output and disconnect behavior before promising how LEDs behave when the host or cable disappears. [Controller output features](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

## Keyboard, spinner, and LED delivery

The controller presents switch input as a USB keyboard. The input adapter consumes host keyboard events and produces the same semantic activations as browser keyboard controls. Ordinary browser key events use the existing local practice bridge. Local WASM practice retains no relay dependency. Replace the former generic USB-serial and GPIO discussion with this concrete input path. [Keyboard correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385945695)

The direction/distance path needs the actual I-PAC setup. Manufacturer configuration describes spinner axes separately from keyboard switch mappings. Confirm whether the board is factory-configured or customized, its known firmware/mode and key map, and its spinner axis. Is relative mouse-axis rotation acceptable, or is an existing key-translation configuration required? This question determines the rotation adapter, not the knob's musical purpose. [WinIPAC configuration](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/?selected_section=product_tab_24)

LED output is a separate controller function. Ultimarc supplies SDK support and identifies Windows and Linux software options. Select the actual host integration after confirming the operating system and available interface. No particular library, packet format, USB permission model, polling rate, or dependency is selected here. [SDK documentation](https://www.ultimarc.com/output/led-and-output-controllers/pacled64/)

The host question is which computer and OS receives the I-PAC first, and where input and LED control must run. A keyboard working in a browser does not prove that its LED interface is accessible from that browser. Chrome protects generic keyboard and mouse HID collections; any distinct LED collection requires its own descriptor and permission verification. This is a constraint to check, not a proposed WebHID implementation. [Chrome HID restrictions](https://developer.chrome.com/docs/capabilities/hid)

Keep browser WASM and native C++ portable by passing controls and light data through host adapters. WASM does not directly operate device pins. Host UI code remains under `ui/`, and reusable peripheral code and native device utilities belong under `lib/`. Confirm SDK and library licensing before adoption. Do not add another controller or require a relay for local practice to work.

## Implementation sequence and first complete demo

The throughput checkpoint is a complete harness plus a replayable input/light demonstration, with the unresolved choices isolated above. The planning revision contains no implementation. Once implementation is authorized, work proceeds in verified milestones.

1. Complete the terminal schedule and configuration record for all arrived parts. Verify the full harness's six switches, direct SpinTrak movement, and four LEDs. Answer the LED wiring and host/configuration questions needed by this work. No extra hardware purchase or one-button-only phase is presumed.
2. Add the portable control and light data under `lib/peripherals/`, coordinated with Performance Engine. Use keyboard-edge and signed-rotation variants, stable button identity, binding revision, accepted command identity, engine frame and beat unit, semantic light state, and timed override identity. Compile shared behavior natively and to WASM. Device code performs IO only, while C++ performs musical decisions and shared light semantics.
3. Replay synthetic keyboard and rotation events through the actual C++ engine with generated PCM and an offline block pump. An explicitly declared test song binds all four buttons and rotation to fixture actions. Use at least two different rotation bindings to prove song-specific interpretation. The fixture must not install a global gain meaning. Capture a DEBUG trace of input, resolved action, accepted frame, light state, and each consumer's output. Use externally supplied candidate light parameters until the operator confirms production values.
4. Connect the full harness through the confirmed host interfaces. Demonstrate each mapped button, pedal tapping starting on different beats, direction/distance in both rotation directions, pending and recording differentiation, one-shot feedback, and browser-pad parity. Verify override expiry after a state change. Record physical results separately from simulation. Where the pattern or musical mapping is still unanswered, report that exact case as pending rather than substituting a default.
5. Add native live-audio hosting later. Audit preparation and callback ownership first. `pf_control()` can reach allocating `st_prepare()` during capture. Do not drain arbitrary controls in an audio callback until prepared-resource ownership is resolved with Performance Engine. [Native performance guide](../../lib/performance/README.md)

The current engine's legacy [control model](../../lib/performance/model.ts) conflates button and channel IDs and exposes an absolute knob control. Its current light flags also collapse distinctions required by this review. Update those contracts with Performance Engine rather than claiming current code already supports the target behavior. The offline demo may exercise current compatibility behavior, but only target-contract conformance establishes the new requirements.

## Verification and resource ownership

Use replayable fixtures to verify one activation per keyboard press, hold/release handling, input order, signed rotary distance, stable IDs across display-label changes, and different per-song bindings. Lost focus or reconnect must clear stale held-input state without synthesizing presses. Lost rotary input must not cause invented catch-up distance. Keep source timing and delivery timing distinct.

Test 6/8 as six eighth-note beats, short measures, and fractional cue/capture positions across varied audio block sizes. Begin pedal sequences on each of the six beat positions. Verify that first-tap arrival leaves transport phase and bar identity intact. Exercise the eventual estimator's accepted tempo changes only under the policy supplied by Performance Engine. Verify immediate manual playback outside its agreed cue-proximity window once that rule is specified.

Drive native and WASM light logic with identical semantic events. Assert distinct pending and recording patterns, one-shot rise/hold/decay, and restoration of the latest normal state. Deliver the same events to LED and browser consumers at different actual or simulated cadences. Verify pattern progress and state agreement rather than equal packet counts. Include duplicate snapshots, late delivery, tempo revisions, and discontinuities. Scope disconnect tests to behavior the actual board and host interface provide.

Give one thread ownership of the engine. `pf_process()` alone advances musical time. Host adapters queue controls and publish copied observations without concurrent engine access. Preserve bounded queues and explicit overflow reporting without inventing transport guarantees. Performance Engine owns command identity, ordering, acknowledgment, and recovery. New scripts use TypeScript. Effect may manage asynchronous host resources and input validation outside synchronous processing; read its installed AGENTS.md before writing Effect code.

Engine-wide logging uses DEBUG for debug runs, INFO for practice, and WARN for performance. Filter diagnostic work before expensive formatting or artifacts. Functional command acknowledgments and state feedback remain available independently of log verbosity. No logging sink or device IO runs on the audio thread. [Logging decision](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380)

Filters and Performance Engine retain audio-route ownership. Process live voice first and cache processed stereo for replay without repeating the baked stack. Mono microphone input feeds left and right. Downloads include wet voice regardless of monitoring eligibility. Monitor and room outputs follow the confirmed physical-device policy, with unknown device metadata requiring annotation. Peripheral input and LEDs do not redefine that route. [Live-first decision](https://github.com/anulman/show-tools/pull/2#discussion_r4385051100), [monitoring decision](https://github.com/anulman/show-tools/pull/2#discussion_r4385119436)

Commit each verified milestone. Run native tests and native/WASM conformance for shared changes, plus the affected repository typecheck, tests, layout checks, and builds. Regenerate ABI source with any coordinated header change. Update architecture.md and development.md when implemented ownership or routing changes. Simulated tests do not prove physical electrical behavior, device latency, or audio underruns.

This documentation revision is verified by checking its source links, review coverage, removed assumptions, and diff scope. Hardware tests, firmware checks, runtime tests, and implementation remain future work. The plan is ready for review while the specific wiring, host/configuration, light-pattern, and engine-policy questions remain open in their owning sections.
