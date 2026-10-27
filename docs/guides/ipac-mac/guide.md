# Build your first I-PAC keyboard

MacBook bench guide · 27 October 2026

Connect one arcade switch, see its key press and release on your Mac, then expand to six switches. Leave the LEDs and custom mounts for later. This guide covers the supplied I-PAC Ultimate I/O and its 4.8 mm switch harness. It does not establish your board's current key map or firmware mode.

## 1. Put the bench parts together

Set out the I-PAC, supplied USB cable, USB-A to USB-C data adapter, switch harness, switch-ground chain, and one 100 mm button. Add a continuity meter if the contacts or leads are unmarked. Keep the Mac's built-in keyboard available.

Leave the 5 V supply unplugged. Set aside the L7A LED leads and the separate 6.3 mm L5A LED-common chain. The keyboard test uses the USB connection, without a powered LED circuit.

## 2. Stabilize the board before wiring

Disconnect USB and external power. Support the board on a dry, nonconductive base with its underside clear of metal. Use the mounting feet if their screws fit the actual holes. Secure the button so pressing it cannot pull the board or expose contacts to loose metal.

## 3. Wire one normally open switch

Seat the supplied switch harness on its matching main input header, aligned with the actual board markings and [Ultimarc's wiring drawing](https://www.ultimarc.com/images/1/uiowiring_sm.png). Identify one switch-input lead and its printed input name. Do not choose a lead by colour or guess the header orientation.

Connect the switch-ground chain's controller end to the documented, marked switch GND connection. Verify its orientation against the actual board and harness.

Connect the input lead to NO. Connect COM to the switch-ground chain. Leave NC unused. On a two-contact normally open switch, use its two switch contacts. Keep both LED tabs disconnected. The button family's switch tabs are 4.8 mm; its LED tabs are 6.3 mm. [Button specification](https://www.adafruit.com/product/1185)

:::switch

> Before USB: confirm the bare switch is open at rest and closes only while pressed. If you cannot identify the input lead or contacts, stop here and obtain the board/harness identification. Do not bridge unknown pins.

The drawing shows electrical relationships, not pin locations. [Controller installation and harness diagram](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

<!-- page -->
# See a key on your Mac

Complete this page with one switch before adding the others. Close performance apps and save other work. An unknown mapping can produce shortcuts rather than printable text.

## 4. Connect USB and identify the device

Unlock the MacBook. Connect the supplied cable to the I-PAC, then through your data adapter to the MacBook. If macOS asks whether to allow the accessory, allow the controller you just connected. Power alone does not establish data access. [Apple accessory approval](https://support.apple.com/en-ca/102282)

Hold Option and open the Apple menu. Choose System Information, then Hardware > USB. Compare the USB tree before and after connection. Record the new product name, vendor ID, product ID, and macOS version. USB presence establishes enumeration, not a working key. [Apple's System Information guide](https://support.apple.com/guide/mac-help/get-system-information-about-your-mac-syspr35536/mac)

## 5. Check press, hold, and release

Open the Input menu > Show Keyboard Viewer. If the menu is absent, open System Settings > Keyboard > Text Input > Edit and enable Show Input menu in menu bar. [Apple's Keyboard Viewer guide](https://support.apple.com/guide/mac-help/use-the-keyboard-viewer-on-mac-mchlp1015/mac)

Press and hold the arcade button, then release it. Observe which key or modifier responds and whether it returns to its released state. Repeat several times. A blank TextEdit document can confirm printable characters, but no text does not mean no input. A held key can repeat normally.

> Pass: one physical switch gives a consistent key response, and the response ends on release. Record the observed identity before choosing a song binding. If the viewer does not expose the key clearly, use the optional raw probe at the end of this guide.

## 6. Recover before adding more wires

| Observation | Next action |
| --- | --- |
| No new USB entry | Disconnect. Reseat the cable and try a known data adapter or another port. Reopen System Information. |
| USB entry, no key | Check for gamepad rather than keyboard mode. Disconnect before checking COM, NO, the input lead, and harness alignment. |
| Key stays down | Disconnect USB. Check for NC use, a jammed switch, or a short to switch ground. Verify the bare switch with a meter. |
| Different or surprising key | Record it. Existing programming and shifted mappings can differ. Do not guess a factory key or rewrite the map to hide a wiring fault. |

Keyboard mode is a controller capability, not a measured fact about your unit. If the current mode is wrong, save its identity and ask for a configuration plan. Do not flash firmware or try mode-change button chords during this test. [Ultimarc modes](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/)

<!-- page -->
# Expand to all six switches

Keep the LEDs disconnected. Give every control a separate, identified input lead. Use COM and NO on a three-terminal switch. On a separate two-terminal NO contact block, use that marked pair between input and switch ground.

## 7. Add the other three pads and mushroom

Disconnect USB before each wiring change. Add and test one switch at a time. Label each cable at both ends.

For the momentary NPB22-M611R mushroom, use its marked NO contact pair. Verify open-at-rest behaviour. Terminal numbers remain unverified. [Operator-supplied reference](https://addison-electronique.com/en/momentary-push-button-switch-mushroom-head-n-o-n-c-red.html)

## 8. Identify the pedal's normally open pair

For the [Adafruit #423 pedal](https://www.adafruit.com/product/423), conductor colours are undocumented. Disconnect every conductor. Use continuity mode to find the pair that is open at rest and closes while pressed. Insulate any unused conductor.

Connect that pair between a separate input and switch ground. For inline joints, check wire-size compatibility. Insulate and strain-relieve the joints.

> The pedal's musical role is BPM tapping. This test proves its switch input; software binding remains separate.

## 9. Record the map and check combinations

Test each control alone, then two together with separate releases. Release each combination promptly. Firmware 50 can persistently change modes after ten-second shift-plus-button holds. [Manufacturer mode instructions](https://www.ultimarc.com/MultiMode.pdf)

Record shifted keys, collisions, and release failures. Reconnect USB and verify fresh presses and releases again.

| Physical control | Board input / lead | Observed key | Release OK |
| --- | --- | --- | --- |
| Pad 1 / label: ______ | | | |
| Pad 2 / label: ______ | | | |
| Pad 3 / label: ______ | | | |
| Pad 4 / label: ______ | | | |
| Mushroom, NO | | | |
| BPM pedal, NO pair | | | |

<!-- page -->
# Add rotation after the keyboard works

The direct SpinTrak is a separate test. A successful keyboard does not prove that the spinner is connected, configured, or reporting movement.

## 10. Identify the direct spinner connector

Disconnect USB and external power. Compare the actual SpinTrak plug and I-PAC markings with the [Ultimate I/O wiring drawing](https://www.ultimarc.com/images/1/uiowiring_sm.png). Use the documented spinner connector. Check its alignment and identification before seating the plug. If the markings are unclear, obtain a matching board-revision diagram before connection.

The [SpinTrak product page](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/) confirms direct Ultimate I/O support. Its separate Opti-PAC instructions require different wiring. Do not cut your direct plug or transfer that pinout to this board.

## 11. Observe movement in both directions

Reconnect USB. Turn the shaft gently clockwise and counterclockwise. Pointer movement is a useful first observation, but does not identify the raw axis, sign, or distance units. Use the optional probe to record relative motion in both directions before writing a hardware adapter.

Observed interface / axis: __________________________________

Clockwise sign / reported units: _____________________________

Counterclockwise sign / reported units: _______________________

> Preserve the signed distance as observed. Sound processing can respond to the presence of rotation; Video can consume the actual signed values. Do not turn the raw signal into global gain or invent an inactivity timeout in the hardware adapter.

## 12. Plan the mounts after the bench test

Keep fabrication separate from the wiring proof. None of these custom parts is a selected, verified commercial fit.

| Assembly | Confirm before fabrication |
| --- | --- |
| Four movable button pods | Actual button underside, retaining hardware, cable exit, and stable base. Two paired pods are a fallback. |
| Disco-ball knob | Ball diameter and mass, shaft dimensions, coupling, and a dedicated weight-supporting mount. Do not assume the encoder shaft can carry the ball. |
| Mushroom mount | Actual contact block, mounting hardware, cable clearance, and a secure press surface. |
| Controller enclosure | Board and feet clearance, USB and power access, insulation, cable glands, and strain relief. |
| Pedal base and cable runs | Nonslip support, reachable layout, service slack, and measured cable lengths. |


<!-- page -->
# Prepare LEDs as a separate stage

The arrived supply and LED leads are useful parts. Their presence does not verify the actual button inserts or their compatibility with the controller outputs. Leave this stage unpowered until the checks below are complete.

:::power

## 13. Verify the actual LED parts

The representative [Adafruit #1185 button](https://www.adafruit.com/product/1185) includes a resistor-equipped LED rated up to 12 V. Its 6.3 mm LED tabs are separate from the 4.8 mm switch tabs. That maximum is not an instruction to feed 12 V to the I-PAC LED supply.

The [I-PAC LED power specification](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) calls for 5 V, centre positive, at a 5.5 mm outer / 2.1 mm inner barrel connector. The arrived [Adafruit #1466 supply](https://www.adafruit.com/product/1466) has those nominal specifications and a 4 A capacity. Check the actual label and polarity before use. A supply's current capacity does not establish an LED's current rating.

Record each actual insert's rated voltage, current or resistor specification, and positive and negative terminals. Obtain manufacturer confirmation if any are unknown. Confirm compatibility with the I-PAC output driver and the selected harness before making the LED circuit.

## 14. Keep the two common chains distinct

The [L7A lead pack](https://www.ultimarc.com/control-interfaces/accessories/9-led-single-color-connection-pack-for-i-pac-ultimate-i-o-interface/) has nine leads plus a common and is 560 mm long. Four LED positions are needed here. Its documented companion is the separate 6.3 mm L5A LED-common chain. Label that chain LED COMMON. Label the switch chain SWITCH GROUND. Do not substitute one for the other.

> Stop before power: confirm the board revision, harness orientation, selected LED outputs, insert polarity and current compatibility, and secure insulation. No terminal position or wire colour in this guide substitutes for those facts.

Once verified, connect one LED with all power disconnected. Follow the matching manufacturer diagram, then inspect it physically during a deliberate single-channel test. The existing peripheral wiring guide covers the guarded brightness command. No LED command or cadence is selected by this document.

## Keep these arrived accessories together

The [L4B replacement pack](https://www.ultimarc.com/output/led-and-output-controller-accessories/extension-harness-pack/) has ten 4.8 mm wires, 600 mm long. The six [Adafruit #3786 inline joints](https://www.adafruit.com/product/3786) join bare wires, not quick-disconnect tabs. The four [CAPFEET mounting feet](https://www.ultimarc.com/output/led-and-output-controller-accessories/pcb-mounting-feet/) include screws. Check actual fit before assembly.

<!-- page -->
# Keep an installation record

Complete the earlier worksheet at the bench. Retain the raw device observations before assigning controls to the practice desk. This guide was source-checked and PDF-reviewed; your physical installation still needs the tests.

## Optional: capture exact input identities

Use this path from the show-tools repository if Keyboard Viewer is inconclusive or you need raw spinner motion. It requires CMake and a C++ compiler. These are manual operator commands. Building opens no devices; list enumerates devices and listen reads attached Ultimarc inputs without seizing them.

```sh
cmake -S lib/peripherals -B lib/peripherals/build
cmake --build lib/peripherals/build --parallel
lib/peripherals/build/peripheral-probe list > /tmp/ipac-devices.ndjson
lib/peripherals/build/peripheral-probe listen all > /tmp/ipac-inputs.ndjson
```

Press and release each switch in worksheet order. Turn the spinner in each direction if connected. End listen with Control-C, then summarize:

```sh
npm run peripherals:summary -- /tmp/ipac-inputs.ndjson
```

If macOS denies input access, check System Settings > Privacy & Security > Input Monitoring for the terminal that runs the probe. Follow any macOS instruction to reopen that terminal. List again after USB reconnection; interface IDs can change. An open handle without observed events is not a passing test.

## Confirm the bench result

- The I-PAC appears in the Mac's USB report through the chosen adapter.
- Each of the six switches has an identified board input and observed key.
- Each press ends on release. Simultaneous inputs and reconnection pass.
- Spinner motion, if connected, is recorded separately in both directions.
- LEDs remain disconnected unless their separate compatibility checks pass.

Mac model / macOS: ________________________________________

USB adapter / cable: ________________________________________

I-PAC board revision / firmware / mode, or unknown: ______________

USB product / vendor ID / product ID: __________________________

Test date / layout / shifted keys / failures: _______________________

## Source and next-step notes

Manufacturer links sit beside the steps they support. The editable guide, source manifest, and render/QA commands are in docs/guides/ipac-mac/. For guarded LED diagnostics, see lib/peripherals/README.md. For confirmed hardware and future musical bindings, see docs/hardware-inventory.md. No Windows utility, firmware update, Sheets helper, or Chrome CDP session is needed for this bench keyboard proof.
