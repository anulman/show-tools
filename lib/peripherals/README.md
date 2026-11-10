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
## Persistent Mac device host

The `peripheral-host` target owns the confirmed I-PAC installation's Tab key
(HID page 7, usage 43), relative Y axis (page 1, usage 49), and one explicitly
selected SDK LED channel. It requires exactly one `d209:0410` device with unique
matching input interfaces and a validated LED report descriptor. It opens only
those interfaces without exclusive seizure. The I-PAC's Tab and cursor-Y events
also reach macOS. Exclusive opening requires privileges that Input Monitoring
alone does not grant. Start it from the context granted Input Monitoring.
It never opens the laptop keyboard.

`peripheral-host --access-status` reports granted, denied or unknown Input
Monitoring permission without prompting. `--inspect` also qualifies the device
without opening any interfaces. Permission and USB enumeration are separate
checks; open failures report their actual macOS error rather than assuming a
permission cause.

`peripheral-host SESSION SDK_CHANNEL --confirm-wiring` is a child-process
interface rather than a stand-alone performance command. The gateway client
supplies a fresh exact positive session integer and owns stdin. Build and
`--help` perform no hardware IO. The current installation uses SDK channel 0,
physical output 1, with its separate 5 V supply connected.

Stdout emits version-one `ready`, `button`, `motion`, `detached` and `delivered`
NDJSON. Unknown or initially held buttons require a release before admission;
repeated held reports and zero motion produce no controls. Raw signed Y distance
is preserved. Registry IDs are discovered per connection rather than saved.
Removal ends the child, and EOF or signals close its interfaces. A parent must
discard pending inputs and release native held state when the child exits.

Stdin accepts `bind ENGINE SESSION REVISION FENCE`, then
`light ENGINE SESSION REVISION FENCE` followed by the complete 78-number PE
publication, or `clear` / `quit`. The existing delivery gate validates and fences
each image; all brightness writes must succeed before commit. `clear` also
disables delivery until a fresh bind. Only brightness reports are written:
unknown peer enable masks are preserved. A disabled physical channel may need
separately verified enable-mask initialization; this helper never guesses it.
The 5 ms run-loop wait services IO and does not advance musical time or animate
lights. The Linux helper implements the same protocol through evdev and hidraw.

Enable hardware audio and leave transport stopped, then run from the permissioned
terminal:

```sh
./show-tools peripheral connect --config /absolute/path/peripheral.json
```

Configuration contains no token value:

```json
{
  "version": 1,
  "origin": "https://YOUR-CONFIGURED-INSTRUMENT-ORIGIN",
  "tokenFile": "/absolute/private/gateway-token",
  "caFile": "/absolute/path/instrument-certificate.pem",
  "helperExecutable": "/absolute/path/peripheral-host",
  "sdkChannel": 0,
  "bindingRevision": 1,
  "jiggle": { "minimumTravel": 4, "minimumReversal": 2 }
}
```

Omit `caFile` when using the system trust store. HTTP is accepted only on loopback.
The token file must be caller-owned with mode 600. The bridge sends no transport
Start or Stop. It resets held state before admitting inputs. An explicit jiggle
object requires native threshold acknowledgement first. Set `"jiggle": null`
to leave physical musical knob actions off: motion reports remain validated and
consume sequence numbers, but send no knob controls or threshold configuration.
Button actions, PE-authored light images and release cleanup remain enabled.
The field is required; omitting it does not select a default. Reconnect after an engine attempt changes or USB is removed.

The starting 4/2 thresholds are software tuning values in raw Y counts rather
than a measured physical deadband. Native C++ owns confirmation and its
quarter-count observation window. Adjacent same-direction reports may combine
during a network acknowledgement; signed travel is retained and reversals stay
ordered. Old queued input is never replayed into another engine attempt.

Ctrl+C clears the local output, makes a fresh bounded release request against the
same native target, and closes the helper. Release failures are reported. Native
stdout and both input streams are bounded. A silently stalled network stream
currently has no automatic fail-dark watchdog. Physical beat alignment remains
subject to network latency. The bridge never guesses an LED enable mask.

### Connect the I-PAC directly to Linux

Build `lib/peripherals` on the EliteDesk, then run `peripheral-host --inspect`
from the build directory. Inspection opens read-only handles and sends no LED
reports. It requires one `d209:0410` USB device with unique Tab, relative-Y and
validated LED interfaces under the same USB parent. The helper discovers actual
evdev and hidraw paths on each launch and retains the qualified handles. It
checks the USB instance again before starting.

The operating-system account needs read access to the selected evdev devices
and read/write access to the selected hidraw device. Permission failures identify
the inaccessible paths. The helper does not use sudo, change permissions, install
udev rules, or take an exclusive input grab.

Use the same `peripheral connect` configuration with the Linux helper path and
the already confirmed SDK channel. Tab maps to the existing cue button and raw
relative Y retains its signed counts. No other switch or LED mapping is inferred.
The current engine publishes one logical LED, not an invented four-button map.

The helper defaults to the confirmed Tab configuration. For a switch confirmed
to emit Escape, append `--button-key escape` to `--inspect`, `--bench-held`, or
the session/channel invocation. Explicit `--button-key tab` selects the default.
The same selection controls interface qualification, initial held state, event
filtering, and inspection output. Escape uses Linux key code 1 and HID page 7,
usage 41. Tab uses Linux key code 15 and HID usage 43. This selects a physical
input without changing the board's firmware or the engine's logical cue action.

Both evdev interfaces must support monotonic event timestamps. The helper merges
bounded available batches by those timestamps and preserves order within each
interface. Ambiguous equal timestamps across interfaces, timestamp regressions,
partial records, input overflow and `SYN_DROPPED` fail the session and attempt to
clear its owned LED. Reconnect after releasing the button. An initially held
button needs a fresh release and press before activation. Keyboard auto-repeat
does not add activations.
Queued observations at or before the initial monotonic cutoff are discarded,
so device discovery cannot replay an earlier press or rotation. This includes
the startup queue reset that Linux can issue when changing an evdev clock.
See the [kernel evdev implementation](https://github.com/torvalds/linux/blob/master/drivers/input/evdev.c).
The runtime's
bounded poll wait permits shutdown signals to reach cleanup even when all
inputs are idle. That service wait does not advance musical time or LED phase.

`peripheral-host --bench-held 0 --confirm-wiring` provides the same audio-free
hold-to-light test for the confirmed output-1 wiring. It sends brightness-only
reports and preserves enable masks. Compile and pipe fixtures establish adapter
behavior without devices; visible Linux LED response and physical cue timing
remain unverified until the controller is moved and tested.


## Hold-to-light wiring test without audio

Build `peripheral-host`, then run this from the terminal granted Input Monitoring
for the confirmed Tab switch and physical LED output 1, SDK channel 0:

```sh
/path/to/peripheral-host --bench-held 0 --confirm-wiring
```

The host clears only that output, then lights it at brightness 255 while a fresh
Tab press is held and clears it on release. An initially held or unknown switch
must be released before a fresh press is admitted. Repeated held reports do not
produce extra activations. Ctrl+C ends the test and attempts to clear the owned
output. Disconnect or a failed USB write ends the process. Physical darkness
after unplugging cannot be guaranteed by software.

This is a wiring test. It opens no microphone, audio device, performance engine,
or network connection, and it generates no cue timing. It sends brightness
reports only and preserves the unknown eight-output enable mask. A disabled
channel therefore remains disabled. It does not monitor the other three button
or LED mappings, which still require individual observation.

## Run browser practice with the local I-PAC

Stop any separate wiring-test monitor before starting this command. One process
owns the board at a time. Build the matching WASM and UI from this checkout, then
use the native `peripheral-host` built with its nonseizing Mac transport.

```sh
npm run build
./show-tools peripheral browser --helper /absolute/path/peripheral-host --static-root /absolute/path/dist
```

Open the printed loopback URL on this Mac. The command serves its own verified
practice build and does not replace the managed practice server. It binds only
`127.0.0.1` and owns LED output 1, SDK channel 0. This is the confirmed one-button
installation, not a guessed map for the other three buttons.

Start practice in the page to prepare browser audio and connect the controller.
The page reports **Controller connected** before transport Start completes. The
local pairing secret stays in this origin's session storage so reload can pair
again. It is removed from the URL before device connection. A second connected
page is rejected rather than taking ownership from the first.

If the button is held or unknown when the helper opens, release it before the
first accepted press. The native input latch does not synthesize an activation.

The browser forwards ordered Tab-button edges and signed spinner motion to its
WASM engine. It sends the engine's complete evaluated light publication to the
native helper. C++ owns every cue window, pulse phase, and brightness decision.
The helper sends brightness reports only and preserves unknown enable masks.
Ordinary Tab focus traversal is suppressed while the helper owns the input.

Closing the page, ending the stream, or missing transport heartbeats for 2.5
seconds requests an LED clear and invalidates the old connection. This heartbeat does
not advance musical time. A background page whose browser suspends timers may
disconnect; the page reports that condition instead of replaying old input.
Restart the local controller session to reconnect after a device disconnect.

This command does not provide held-button feedback before browser audio is
prepared. Use `peripheral-host --bench-held 0 --confirm-wiring` for the separate,
audio-free wiring test, then stop that process before opening this mode.

HTTP acknowledgement means the helper accepted the image into its bounded input
queue. It does not prove completed USB delivery or measured physical timing.
If that queue stalls, the server stops and reaps the owned helper with bounded
TERM and KILL deadlines. A disconnected or unresponsive device can prevent the
final off report from reaching the LED.

The bridge configuration accepts an optional literal-IP `connectAddress` when the host cannot resolve its configured origin. This changes only the connection destination: Host, Origin, TLS SNI and certificate identity still use `origin`, with normal CA verification. HTTP overrides must be loopback; omit the field for normal DNS resolution.

### Keep the Linux controller available

`show-tools peripheral serve --config /absolute/path/peripheral.json` keeps the
controller available without enabling audio. It polls authenticated status while
audio is off, then waits for the sole supported USB board. The config is the
same explicit endpoint, credentials, helper, LED binding and jiggle thresholds
used by `connect`; it contains no USB port, device-node name or process ID.
Changing ports or reconnecting the board does not require another setup script.
The Linux device-access rule must already be installed once by the operator.

Each attachment uses new helper and command-session identities. Cleanup clears
the owned LED and releases the native button before a replacement child starts.
Pending controls are discarded; uncertain controls are never replayed. The
native engine remains the only musical clock and LED-pattern author. A transport
already playing may attach only when native jiggle configuration is acknowledged;
identical thresholds are a native no-op, while changed thresholds require Stop.
An explicit `jiggle:null` skips threshold configuration and drops physical musical
knob input without changing the native engine’s existing threshold state.
This requires the matching native engine implementation of that no-op.

If USB appears before input/hidraw nodes or permissions, a failed qualification
holds until that board's interface/access metadata changes. An unchanged fault
does not repeatedly spawn the helper. Multiple boards, invalid credentials, TLS,
protocol or configuration errors require correction. No permissions are changed
by the service. Gateway SSE comments establish a one-second connection heartbeat;
five seconds without a heartbeat or publication fails the connection, clears the
local output and permits a fresh attachment. These are connection deadlines,
not musical timers. The helper cannot guarantee darkness after hard power loss
or an inaccessible/disconnected device.

`renderPeripheralUnit()` in `service-unit.ts` renders a source-only systemd user
unit for an installed `bin/show-tools-peripheral` and private config. Its
`default.target` enablement is suitable for an already-lingering user manager;
it restarts abnormal process exits with a three-second backoff, while normal
configuration failures remain stopped for diagnosis. Ordinary gateway/USB loss
is handled inside `serve`. This renderer neither installs nor enables a service.
The existing web-only host grant does not admit this new named device service:
its initial operator-controlled installation/activation is a separate missing
capability. Reboots and reconnects after that bootstrap do not need setup again.

A laptop or phone disconnect leaves the EliteDesk's native audio running. Local
controller reconnection handles gateway unavailability; it does not change
Tailscale, networking, the audio lifecycle, or transport. If Tailscale removes
its local address, a web service bound to that address must itself become
available again before the controller can reconnect.


### Select the confirmed physical switch key

The bridge config accepts optional `buttonKey: "tab" | "escape"`. Omit it to
preserve existing Tab helper behavior. An explicit value appends the native
helper's `--button-key tab|escape` flag; the helper uses that key for interface
qualification and held/press/release input. The logical performance control is
still `cueButton`; this changes neither firmware nor musical bindings.

For the EliteDesk board whose operator capture identified Escape (Linux
`KEY_ESC` 1, HID keyboard usage 41), the proposed private profile addition is:

```json
{"buttonKey":"escape"}
```

This is a profile proposal, not an installed host change. Use a matching native
helper release with the optional flag; older helpers reject explicit selections
rather than silently using another key. Existing profiles without `buttonKey`
retain their original arguments. LED channel and jiggle configuration stay
explicit and independent of the physical key selection.
