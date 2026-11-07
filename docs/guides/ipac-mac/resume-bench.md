# Resume the Mac bench test

Use this procedure to recover the verified spinner and LED setup, then add the remaining controls. Read the [installed bench state](../../hardware-inventory.md#installed-bench-state) first.

## Prepare the board

1. Disconnect USB and external 5 V power before moving any wire.
2. Keep the board on its mounting feet with its underside clear of conductive material.
3. Keep the switch-ground chain separate from the LED-positive common chain.
4. Check that the spinner plug occupies the verified header row. Use the Ultimate I/O markings and [manufacturer wiring diagram](https://www.ultimarc.com/images/1/uiowiring_sm.png). Colour alignment alone did not prevent the earlier wrong-row connection.
5. Reconnect the regulated 5 V supply directly to the I-PAC's black power socket.
6. Reconnect USB to the MacBook.

If a spade connector resists removal, leave it attached rather than pulling the wire or bending the blade. Change to a connector that can be removed without damage.

## Build and discover the current interfaces

From the repository root, build the diagnostic.

```sh
cmake -S lib/peripherals -B lib/peripherals/build -DCMAKE_BUILD_TYPE=Release
cmake --build lib/peripherals/build --parallel
lib/peripherals/build/peripheral-probe --help
lib/peripherals/build/peripheral-probe list > /tmp/ipac-devices.ndjson
```

Open `/tmp/ipac-devices.ndjson`. On the verified Mac, the LED interface has vendor `53769`, product `1040`, usage `0`, and `outputBytes` of `97`. Copy its `device` value. Replace `OUTPUT_DEVICE_ID` below with that exact value. Run `list` again after every USB reconnect. Registry IDs are temporary.

## Repeat the spinner and switch checks

1. Start a read-only recording.

```sh
lib/peripherals/build/peripheral-probe listen all > /tmp/ipac-inputs.ndjson
```

2. Turn the spinner clockwise, then counterclockwise. Expect relative Y records with usage page `1`, usage `49`, and signed values in both directions. On this installation, clockwise moves the cursor down and counterclockwise moves it up.
3. Press and release the switch on the plug identified as `2a`. Expect `j` on the Mac. Confirm both press and release in the capture rather than treating repeated text as multiple presses.
4. Stop the recording with Ctrl-C.
5. Summarize the capture.

```sh
npm run peripherals:summary -- /tmp/ipac-inputs.ndjson
```

If macOS denies input access, grant the responsible terminal Input Monitoring permission, then repeat the recording. A successful device open without input records is not a passing check.

## Repeat the LED 1 check

Keep the current LED 1 polarity. Its physical output number `1` corresponds to SDK channel `0` in the verified setup.

The following enable and pulse commands disable the other seven outputs in the selected eight-output group. Use this procedure while testing one LED in isolation.

1. Enable output 1 at full brightness.

```sh
lib/peripherals/build/peripheral-probe led-on OUTPUT_DEVICE_ID 0 --confirm-wiring
```

2. Confirm that the button visibly lights.
3. Request four smooth pulses, each 2.4 seconds long.

```sh
lib/peripherals/build/peripheral-probe led-pulse OUTPUT_DEVICE_ID 0 --confirm-wiring
```

4. Confirm four visible fades down and back up, followed by the LED turning off.
5. Turn the selected output off when finished.

```sh
lib/peripherals/build/peripheral-probe led OUTPUT_DEVICE_ID 0 0 --confirm-wiring
```

Command success means the host accepted the reports. Only visual inspection confirms light output. The diagnostic does not alter firmware, key mappings, or stored LED scripts.

## Recover a dark LED without repeated polarity swaps

1. Disconnect both supplies.
2. Reconnect external 5 V power only, leaving USB disconnected.
3. Leave the buttons and spinner untouched for 15 seconds. The [factory script](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) runs at power-on and stops when a control activates.
4. If the LED lights, keep that polarity. Reconnect USB, discover its new IDs, and repeat the manual LED test.

The onboard script lit LED 1 during the verified session. If no light appears, the result does not distinguish a changed script from missing power, a loose contact, polarity, or a faulty LED. Do not declare any one cause from darkness alone. Disconnect both supplies before inspecting or moving connections.

## Add the remaining controls

1. Leave the working spinner and LED 1 connections in place.
2. With both supplies disconnected, connect one remaining arcade switch using the selected `1a`, `2a`, `1b`, and `2b` set.
3. Reconnect USB and capture that switch's press and release separately.
4. Record its actual connector label, emitted key, and physical button identity in the [inventory](../../hardware-inventory.md#installed-bench-state).
5. With both supplies disconnected, check one remaining LED's positive common and numbered negative lead. Verify its polarity and SDK index individually before recording the result.
6. Repeat for each remaining arcade button.
7. Inspect the pedal's actual conductors and mushroom's actual contact markings before selecting their input leads. Use the selected normally open mushroom contact. Do not infer contact numbering from another model.
8. Connect and test the pedal, then the mushroom, one at a time. Record distinct press and release reports before adding musical bindings.

The pedal is intended for BPM taps. The mushroom's musical action remains unassigned. Physical connectors and raw keys do not select song actions.
