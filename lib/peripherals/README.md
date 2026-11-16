# Test the I-PAC control harness

For a first MacBook bench setup, use the [illustrated keyboard guide](../../docs/guides/ipac-mac/README.md). It starts with one unlit switch and includes an observed key-map worksheet. For the installed setup, use [Resume the Mac bench test](../../docs/guides/ipac-mac/resume-bench.md) and the [current bench record](../../docs/hardware-inventory.md#installed-bench-state).

This package provides an operator-run input probe and guarded LED brightness, enable, and pulse commands for the arrived I-PAC Ultimate I/O. It also provides a portable C++ input latch, explicit light math, capture summaries, and native/WASM fixtures. Building and testing never opens hardware.

The [inventory](../../docs/hardware-inventory.md) covers all four illuminated arcade buttons, the foot pedal, mushroom normally open contact, and direct SpinTrak. Test the entire harness. Musical purposes belong to the song and Performance Engine. This tool does not change WinIPAC mappings, firmware, or stored LED scripts.

## Build without accessing hardware

Use a C++17 compiler and CMake 3.20 or newer. On Mac, install the Xcode command-line tools first. The Mac probe uses system IOKit and CoreFoundation frameworks. The Linux probe uses kernel evdev and hidraw interfaces without additional libraries.

```sh
cmake -S lib/peripherals -B lib/peripherals/build -DCMAKE_BUILD_TYPE=Release
cmake --build lib/peripherals/build --parallel
lib/peripherals/build/peripheral-probe --help
```

For the full verification, also install the repository's locked Node dependencies and put Emscripten's `em++` on PATH.

```sh
npm ci
npm run test:peripherals
```

The verification executes C++ tests, real performance-engine PCM, native/WASM conformance, CLI help/refusal tests, and synthetic capture-summary tests. It does not call `list`, `listen`, or a device write. Generated output stays in ignored `lib/peripherals/build/`. An optional build directory is accepted by `node --import tsx lib/peripherals/scripts/verify.ts /your/build/path`.

## Record the actual installation

Record the host OS, I-PAC firmware/mode if known, and existing WinIPAC map. "Factory configuration, version not yet known" is a valid starting record. The software does not assume the spinner axis, keycodes, LED channel assignment, or physical clockwise sign.

Complete this terminal sheet from board markings and the actual harness before selecting connections. Blank cells require observation, not a software default.

| Physical item | I-PAC input/connector | Observed code/axis | LED SDK index and polarity |
| --- | --- | --- | --- |
| Button 1 | | | |
| Button 2 | | | |
| Button 3 | | | |
| Button 4 | | | |
| BPM pedal | | | Not applicable |
| Mushroom, normally open | | | Not applicable |
| Direct SpinTrak | | | Not applicable |

Ultimarc documents direct SpinTrak connection, ground-referenced switch inputs, and separate LED power. Use the actual Ultimate I/O connector markings, not an Opti-PAC wiring table. [Manufacturer installation](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

Adafruit specifies 4.8 mm switch terminals and 6.3 mm LED terminals for the button family. Its stock LED insert has a built-in resistor and is rated for operation up to 12 V. That maximum does not select the supply for this installation. Confirm the actual LED inserts, LED harness, polarity, and power source before using the brightness command. The included 4.8 mm switch harness is not an LED wiring specification. [Button specifications](https://www.adafruit.com/product/1185)

## Inspect on a MacBook

After the operator connects the completed harness and USB cable, run this command explicitly.

```sh
lib/peripherals/build/peripheral-probe list > /tmp/ipac-devices.ndjson
```

The output includes each visible Ultimarc interface's registry ID, product, usage page, usage, output size, and raw report descriptor. A composite board may expose separate keyboard, spinner, and output interfaces. IDs describe this connection and can change after reconnecting. Save this output with the configuration record.

To observe all attached Ultimarc input interfaces, run the following command. It reads without seizing the device and does not send LED commands. Ctrl-C ends the recording.

```sh
lib/peripherals/build/peripheral-probe listen all > /tmp/ipac-inputs.ndjson
```

For one interface, replace `all` with its exact registry ID from `list`. macOS may require permission for the terminal under **Privacy & Security > Input Monitoring**. An open error reports that requirement. A successful open alone does not prove events are delivered. Verify the observed press/release and motion records below.

## Inspect on a Linux EliteDesk

Build with the same CMake commands on the EliteDesk. List its interfaces explicitly.

```sh
lib/peripherals/build/peripheral-probe list > /tmp/ipac-devices.ndjson
```

Select a reported `/dev/input/eventN` path for input. The following placeholder must be replaced with the observed path.

```sh
lib/peripherals/build/peripheral-probe listen /dev/input/eventN > /tmp/ipac-inputs.ndjson
```

Keyboard and spinner may have separate event paths. Capture each as a separate session. Device access depends on the installation's permissions. The tool reports denied access and never changes permissions or grabs the device. It reports initial held keys and `SYN_DROPPED` gaps. Lost rotation is unrecoverable; the tool does not invent replacement distance. Kernel event timestamp fields are preserved without claiming they use the engine clock.

The native probe currently targets macOS and Linux. A Windows EliteDesk can use Ultimarc's configuration/test software, but this package does not yet contain a Windows probe. Confirm the EliteDesk OS before choosing a Windows integration. No Windows or physical-device support is inferred from successful Mac compilation.

## Check every input

1. Press, hold, and release each of the four buttons separately. Repeat for the pedal and mushroom. Confirm each has a distinct observed key identity and both edges.
2. Press several controls together and verify all their edges. Record any configured shifted key behavior rather than interpreting it as another musical action.
3. Rotate SpinTrak clockwise, then counterclockwise. Confirm relative events in both directions and preserve their signed distance. Record the observed axis and sign. A pointer moving on screen alone does not identify the raw report or distance units.
4. End each capture with Ctrl-C. Reconnect USB, list again, and repeat. Do not reuse a stale device ID or concatenate restarted sessions as one ordered stream.
5. Summarize each recording with this command.

```sh
npm run peripherals:summary -- /tmp/ipac-inputs.ndjson
```

The summary reports raw codes, press/release observations, Linux repeat events, signed and absolute movement distance, gaps, errors, operator stops, and disconnects. It assigns no button names or song actions. Empty input, missing edges, or an axis that never reports both directions is not a successful wiring test. Keep raw captures outside Git.

## Test one LED at a time after confirming wiring

The encoder follows `Pac64SetLEDIntensity` in Ultimarc's MIT-licensed [PacDriveSDK.zip](https://www.ultimarc.com/PacDriveSDK.zip). The supported command uses Output report 3 and four data bytes. Before sending it, the probe requires an observed matching descriptor and an SDK-supported I-PAC vendor/product identity. A successful input capture is not enough. Unsupported firmware/interface shapes fail without output. [SDK details](licenses/README.md)

Select the output interface from `list`. On Mac, use its exact registry ID. On Linux, use its listed `/dev/hidrawN` path. The arguments below are placeholders requiring the completed terminal sheet.

```sh
lib/peripherals/build/peripheral-probe led OUTPUT_DEVICE_ID SDK_CHANNEL LEVEL --confirm-wiring
```

`SDK_CHANNEL` is the SDK's zero-based index from 0 through 95, not a PCB label. `LEVEL` is an explicitly chosen integer from 0 through 255. Test each of the four confirmed LED connections individually. Inspect the light physically, then send level 0 to that same index to turn it off. The command sends one brightness report and exits. It does not select an update cadence or reset the board on exit. No successful return value can establish electrical suitability or visible brightness.

To enable a selected output before setting full brightness, use `led-on`. To reproduce the accepted smooth bench demonstration, use `led-pulse`.

```sh
lib/peripherals/build/peripheral-probe led-on OUTPUT_DEVICE_ID SDK_CHANNEL --confirm-wiring
lib/peripherals/build/peripheral-probe led-pulse OUTPUT_DEVICE_ID SDK_CHANNEL --confirm-wiring
```

Both commands write the SDK's eight-output group mask, enabling the selected channel and disabling the other seven outputs in that group. For SDK channel `0`, peers `1` through `7` are disabled. These commands do not preserve an unknown existing group mask. Use them for isolated bench testing.

`led-pulse` requests four cosine brightness cycles, 2.4 seconds each, with 100 steps per cycle. It starts at level 255 and turns the selected LED off after the four cycles. A failed pulse brightness write stops the sequence and makes one off attempt. LEDs should remain off when idle or when a test has finished; light output is for active feedback or an explicitly requested illumination test. Native host code uses a steady clock to schedule these diagnostic writes. OS scheduling and USB delivery do not establish exact physical timing. This command does not set a production cadence, song binding, or musical feedback pattern. Interruption or disconnect may leave the last brightness; no automatic fail-dark behavior is provided. Use the existing `led` command with level `0` for an explicit off command.

The probe sends no report if confirmation is missing, the channel or level is invalid, or the observed descriptor is unsupported. The command does not update firmware, input maps, board IDs, fade speed, or stored scripts. Disconnect behavior and any preconfigured onboard fading remain actual-device checks. No automatic timeout or fail-dark guarantee is provided.

## Reusable LED routines

Use [Logical LED recipes](LIGHTS.md) for PE-callable off, steady low/mid/max, smooth pulse, and blink routines by logical LED ID. PE callers supply the brightness table and engine-authored count-beat position, origin, period, and blink duty. PE exclusively owns musical activation, keyframes, quantization, phase, and tempo changes. The host samples or delivers engine-authored output. The evaluator performs no IO, scheduling, or implicit quantization. This API does not establish a production PE light snapshot or device service.

For complete PE output images, use the [hardware-free delivery gate](DELIVERY.md). It validates connection fences and prepares brightness reports without choosing musical phase or performing device IO.

## Portable control and light contract

[peripheral_controls.h](include/peripheral_controls.h) is an isolated C ABI. `pp_begin` supplies a new device session plus explicit known-released and initially-held masks for up to 32 switch slots. Unspecified slots are unknown, not assumed up. Unknown or initially held controls must be released before a fresh activation. A valid ignored observation consumes its sequence. Invalid observations leave state unchanged. Old sessions and nonincreasing sequences are rejected. Recreate before exhausting the JavaScript-safe session counter.

`pp_key` removes held reports without adding mechanical debounce. `pp_rotate` preserves ordering and validates a caller-owned signed distance. The caller retains raw units, stable input/button identity, timestamps, and binding revision. A program change must not clear held latches or synthesize a press. The normalizer neither resolves songs nor accumulates gain. Song-specific twiddling/start/stop gesture interpretation belongs to the engine; the adapter adds no idle timeout or synthetic stop gesture. Engine epoch changes invalidate pending semantic commands and feedback through Performance Engine's contract; they do not prove a physical key has been released.

`pp_pattern_value` evaluates explicit triangular pulse or rectangular blink profiles. `pp_trigger_value` evaluates an explicit zero-based attack/hold/decay replacement shape and then returns the current supplied baseline. Both consume elapsed frame or continuous-beat coordinates without advancing or extrapolating time. Negative pattern elapsed wraps its period. Negative trigger elapsed returns baseline. Zero-duration segments are permitted, but the total envelope must be positive.

These are selectable math shapes, not approved production patterns or composition policy. A replacement envelope over an already-solid baseline can jump at its endpoints. Pending-versus-recording assignment, pulse shape, timing, overlap priority, and replacement/max/blend composition still need operator decisions before production integration. Tests use explicitly synthetic values. PE owns semantic state, accepted trigger identity, current baseline, epoch/session gating, and continuous position. Consumers retain absolute trigger origins and smooth at their own cadence. No snapshot receipt time becomes a clock.

For 6/8, chart and pedal count six eighth-note beats. The first pedal tap can occur on any beat and must not infer a downbeat or reset transport phase. Armed feedback remains distinct from recording. The engine may change an effect route when capture is armed while recording still waits for its declared boundary; the adapter must not infer onset or alter clock/loop state. Overlapping captures are currently rejected by the target engine policy. The core only normalizes input. The current PF compatibility fixture still uses the existing 4/4 interface; 6/8, tap estimation, fractional musical cues, song-bound relative input, and production browser-pad integration remain coordinated Performance Engine work.

## What verification establishes

The native tests cover reconnect latches, ordering, raw rotation, explicit light math, envelope endpoints, baseline changes at expiry, malformed descriptors, and exact SDK report encoding. The WASM build runs the same assertions and compares emitted values against native execution. The separate PF fixture applies four deliberately reordered button-to-channel bindings to the real C++ engine, captures generated PCM sequentially, commits and auto-plays four loops, renders their mix, and stops them. The fixture forwards identical signed rotation to two explicit host-side test bindings, one selecting a target and one enabling click. This proves the normalization seam can feed different operations; it does not test song-based resolution.

Mac and Linux CI compile the probe and exercise its help and refusal paths without hardware. Stop/disconnect/error summary counters have synthetic coverage. The original implementation checks opened no physical I-PAC. Subsequent MacBook bench testing verified keyboard input, signed relative Y motion, and visible control of LED output 1. See the [bench verification record](../../docs/guides/ipac-mac/bench-verification.md) for the limits of those observations. The checked-in enable/pulse commands have automated protocol and failure-path tests; their packaged hardware execution still needs a repeat. Linux physical operation, the remaining input and LED map, latency, and exact physical pulse timing remain unverified.
## Persistent device host

`peripheral-host` uses an explicit version-two installation map on macOS and Linux. Physical controls are `blue`, `yellow`, `red`, `green`, `pedal`, and `mushroom`. The relative axis is `knob`. These names identify wiring, not cue rows. No key, interface, LED channel, or musical target has a default. The [routing contract](../../docs/implementation/physical-control-routing.md) defines the engine boundary and current physical acceptance gaps.

Build and `--help` open no devices. Run `--inspect` only when inspection is requested. It reports observed interfaces and capabilities without opening output delivery. On Mac, `--access-status` checks Input Monitoring without prompting. Start the Mac host from the context granted that permission. Inputs also reach the operating system because the helper does not seize them.

The production child interface is:

```text
peripheral-host SESSION --map-version 2
  --linux-source ID INTERFACE EVENT_TYPES KEY_CODES RELATIVE_AXES
  --switch CONTROL SOURCE TYPE CODE
  --axis knob SOURCE TYPE CODE
  --led CONTROL SDK_CHANNEL --confirm-wiring
```

Use `--hid-source ID INTERFACE USAGE_PAGE USAGE` instead of `--linux-source` on Mac. Repeat source, switch, and LED arguments as needed. Axis and LED mappings are optional. Linux capability lists are sorted, unique decimal values separated by commas; `-` means empty. A source ID contains at most 32 ASCII letters, digits, underscores, or hyphens. The whole map is validated before device access. Source selectors must resolve uniquely within the qualified board.

Linux selectors use the observed USB interface number and exact event-type, key-code, and relative-axis capability sets. HID selectors use the observed interface and top-level collection usage; input mappings select elements inside that collection. Device paths, USB ports, registry IDs, and enumeration order are not persistent selectors. Unavailable or ambiguous identity blocks attachment rather than choosing a likely interface.

An empty LED map requires no LED interface and produces no USB output writes. Mapped LEDs require independently confirmed wiring and zero-based SDK channels. Physical LED IDs 257 through 262 correspond to the six physical controls in registry order, independently of SDK channel numbers.

Stdout emits version-two NDJSON. Ready contains `switches: [{controlId, state}]`, where state is `released`, `held`, or `unknown`. Buttons contain `controlId`, `down`, `session`, and `sequence`; motion contains signed `deltaY`. The first release of an initially held or unknown switch is forwarded to clear the engine's release barrier. It admits no musical release. Repeats consume observation order without another press. Sequence numbers increase but need not be contiguous. Explicit loss or disconnect revokes the stream.

Stdin accepts `bind ENGINE SESSION REVISION FENCE`, then `light` with the same tuple and the complete 78-field native publication, or `clear` and `quit`. Complete-frame prepare/deliver/commit fencing remains mandatory. Only brightness reports are written. The helper does not change enable masks, advance musical time, animate LEDs, or choose song targets. Input-only sessions retain validated zero-report bind/light acknowledgements.

## Connect to hardware audio

With an explicitly configured hardware session available, run:

```sh
./show-tools peripheral connect --config /absolute/path/peripheral.json
./show-tools peripheral serve --config /absolute/path/peripheral.json
```

The configuration requires `version: 2`, the gateway `origin`, private absolute `tokenFile`, `helperExecutable`, positive `bindingRevision`, explicit `inputMap`, and `jiggle`. Optional `caFile` and `connectAddress` retain the existing TLS and routing contract. The token value belongs in its caller-owned private file, never in JSON or songs. `jiggle` is either `null` or an explicitly selected `{minimumTravel, minimumReversal}` object. Disabled motion still consumes sequence numbers; buttons and feedback continue.

`inputMap` contains:

| Field | Required data |
| --- | --- |
| `sources` | One to eight unique selectors. Linux uses `{kind:"linux", id, interfaceNumber, eventTypes, keyCodes, relativeAxes}`. Mac uses `{kind:"hid", id, interfaceNumber, usagePage, usage}`. |
| `switches` | Up to six unique `{controlId, sourceId, type, code}` entries. Linux uses EV_KEY and the observed key code. Mac uses element usage page and usage. |
| `axis` | Optional `{sourceId, type, code}`. Linux requires EV_REL and the observed relative axis. Mac requires a relative HID element. |
| `leds` | Up to six unique `{controlId, sdkChannel}` entries, or `[]` for input-only operation. |
| `confirmWiring` | Boolean. It must be true when LEDs are mapped. |

Every declared source must supply an input. Raw inputs cannot alias controls. The map belongs to one host platform and contains no musical targets. Version-one `sdkChannel`/`buttonKey` configurations are refused. Migration requires observed selectors and confirmed physical identities; historical Tab or Escape settings cannot identify a colour. Musical bindings are selected separately in canonical song `inputBindings` and remain unbound when absent.

The gateway assigns native producer slots and monotonic sessions to authenticated clients. The bridge submits only the physical role, generation, initial masks, and ordered observations. Cleanup revokes that client's physical source, never a global cue release. Start, Stop, and song preparation retain their normal lifecycle rules. `serve` waits for audio/device readiness and reconnects after a completed cleanup; it starts no audio, browser, or Sheets helper.

The operator packet preparer additionally requires `--input-map FILE` before emitting an activatable packet. It validates explicit Linux selectors and retains the exact installer, release, credential, unit, and idle checks. Updating this source does not install or expand a remote delegation. An older installed authority may still refuse the new profile until its operator-controlled migration is reviewed.

## Use browser audio with local controls

```sh
./show-tools peripheral browser --helper /absolute/path/peripheral-host --static-root /absolute/path/dist --input-map /absolute/path/input-map.json
```

This explicit command starts an owned loopback bridge and prints its paired URL. Use the existing deterministic practice launcher for ordinary practice. The bridge does not replace the managed live server or start Chrome/CDP.

Choose **Physical controls** in that browser before attachment. **Keyboard shortcuts** enables musical DOM keys and wheel input; **Choose input mode** leaves pointer/touch usable without those shortcuts. The choice is stored per browser tab session. Native controls cannot automatically distinguish a USB keyboard from a laptop keyboard by DOM event properties, hostname, or device lease. Another remote browser's keyboard choice stays independent.

Keyboard, pointer, and physical input have separate native leases. Policy changes and blur revoke only keyboard ownership; changing away from physical controls closes only that connection. Physical reattachment waits for its previous revocation acknowledgement. Failed same-engine cleanup remains blocked. A new engine identity can retire an old local lease without sending cleanup into the replacement.

Explicit UI Panic remains the existing global utility, including immediate local recording/microphone cleanup when its acknowledgement fails. The DOM policy runs before Escape. A physically bound Panic uses identified input and the native generation-checked priority lane. Native Panic readback also completes local UI cleanup without a second Panic action.

## Verify without hardware

```sh
node --import tsx --test lib/peripherals/tests/bridge.test.ts lib/peripherals/tests/browser-server.test.ts
node --import tsx --test ui/practice/tests/browser-peripheral.test.ts ui/practice/tests/musical-input-policy.test.ts
node --import tsx --test lib/peripherals/tests/operator-service.test.ts
cmake -S lib/peripherals -B /tmp/show-tools-peripherals -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-peripherals --parallel
ctest --test-dir /tmp/show-tools-peripherals --output-on-failure
```

Build the current fake native host and set `NATIVE_FAKE_HOST` to that executable for `bridge-integration.test.ts` and `managed-runtime.test.ts`. These fixtures use owned HTTP/IPC listeners and synthetic helpers. Linux runtime tests use pipes, synthetic capability maps, and controlled write failures. Mac compilation and Linux cross-compilation do not establish actual Linux runtime behavior. Linux CI must execute the runtime fixtures. None of these checks establishes electrical suitability, raw Blue/Yellow codes, physical latency, or a successful practice audition.
