# Confirmed peripheral inventory

Source: the operator's [PR #3 inventory comment](https://github.com/anulman/show-tools/pull/3#discussion_r4385787375) and [arrival confirmation](https://github.com/anulman/show-tools/pull/3#discussion_r4385950356). All listed components have arrived; the plan can cover the complete harness.

| Quantity | Component | Operator-supplied reference |
| --- | --- | --- |
| 4 | 100 mm illuminated arcade buttons with LEDs | [Adafruit #1185](https://www.adafruit.com/product/1185), representative colour from the same button family |
| 1 | Momentary foot pedal with 2 m cable | [Adafruit #423](https://www.adafruit.com/product/423) |
| 1 | Red momentary mushroom button, NO/NC contacts; use NO | [Addison NPB22-M611R](https://addison-electronique.com/en/momentary-push-button-switch-mushroom-head-n-o-n-c-red.html) |
| 1 | SpinTrak rotary encoder, direct I-PAC connection, no separate USB interface | [Ultimarc SpinTrak](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/) |
| 1 | I-PAC Ultimate I/O input/LED controller, 4.8 mm harness variant | [Ultimarc I-PAC Ultimate I/O](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) |

The operator's subsequent MacBook bench-guide request confirms these additional arrived parts. The [Mac keyboard guide](guides/ipac-mac/README.md) provides the first-switch procedure and separate LED checks.

| Quantity | Component | Operator-supplied reference |
| --- | --- | --- |
| 1 | Regulated 5 V, 4 A supply, centre-positive 5.5/2.1 mm plug | [Adafruit #1466](https://www.adafruit.com/product/1466) |
| 1 each | Supplied USB cable, 4.8 mm switch harness, and switch-ground daisy chain | [I-PAC kit](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) |
| 1 | L7A nine-position single-colour LED lead pack, 560 mm, four positions needed | [LED connection pack](https://www.ultimarc.com/control-interfaces/accessories/9-led-single-color-connection-pack-for-i-pac-ultimate-i-o-interface/) |
| 1 | L5A 6.3 mm LED-common daisy chain, separate from switch ground | [Daisy-chain harness](https://www.ultimarc.com/arcade/button-accessories/daisy-chain-harness/) |
| 1 | L4B ten-wire 4.8 mm replacement pack, 600 mm | [Extension harness pack](https://www.ultimarc.com/output/led-and-output-controller-accessories/extension-harness-pack/) |
| 6 | Solder-free inline wire joints, two three-packs | [Adafruit #3786](https://www.adafruit.com/product/3786) |
| 4 | CAPFEET PCB mounting feet with screws | [Mounting feet](https://www.ultimarc.com/output/led-and-output-controller-accessories/pcb-mounting-feet/) |

The first bench host is the MacBook through the operator's USB-A to USB-C adapter. Keyboard input, signed relative spinner input, and visible control of LED output 1 work on this host. The board is mounted on feet. The Adafruit #1466 supply connects directly to the I-PAC's black barrel socket. The supplied PC drive-power adapter cable is not used on the Mac. LED current has not been measured. The other three LEDs still need individual checks.

Custom fabrication remains unselected: four movable 100 mm button pods, with two paired pods as a fallback; a disco-ball knob coupling and separate weight-supporting mount; a mushroom mount; a controller enclosure with USB and power access, insulation, and strain relief; and a nonslip pedal base. Select wiring lengths, glands, and fasteners after measuring the layout. Confirm the ball's dimensions and mass and the shaft/coupling fit before designing its support. Do not assume the encoder shaft is load-bearing.

The [CAD review workspace](../hardware/cad/README.md) provides a local build123d/OCP viewer and Scrawl feedback loop. Its synthetic demonstration checks the toolchain, not actual mounting dimensions or fit.

The I-PAC is the controller board in this parts plan. Do not introduce an additional Arduino or choose a different controller without asking the operator.

## Installed bench state

This record reflects the operator's MacBook bench session and confirmation on 2026-10-28. It supersedes earlier statements that all physical testing remains pending. Use [Resume the Mac bench test](guides/ipac-mac/resume-bench.md) to repeat the checks. The [bench verification record](guides/ipac-mac/bench-verification.md) distinguishes observed behavior from automated tests.

| Item | Confirmed observation | Remaining work |
| --- | --- | --- |
| I-PAC Ultimate I/O | USB vendor `d209`, product `0410`; keyboard, relative mouse, and LED interfaces enumerate | Firmware release name and full input map are not established |
| SpinTrak | Signed relative Y input, HID usage page `1`, usage `0x31`; clockwise moves the Mac cursor down, counterclockwise moves it up | Calibrate physical rotation against raw counts if needed. Cursor direction was operator-observed, not annotated onto the raw capture |
| Arcade switch on the plug identified by the operator as `2a` | Emits `j` on the Mac | Record press and release edges alongside a confirmed connector label when completing the map |
| Four arcade switch connections | Operator selected `1a`, `2a`, `1b`, and `2b` | Complete wiring and inventory each key separately. This is a planned set, not four verified mappings |
| Arcade LED output `1` | SDK channel `0` lights in its current orientation; manual brightness changes and four smooth 2.4-second pulses were visible | Record the physical button identity and permanent polarity marks when labelling the assembly |
| Other three arcade LEDs | Leads were attached during the session | Verify polarity, physical button identity, and output number individually |
| Foot pedal | Arrived; intended for BPM taps | Wire and capture press/release behavior in the next bench session |
| Mushroom button | Arrived; normally open contact selected | Wire and capture press/release behavior in the next bench session. No fixed musical action is assigned |

The observed `2a` label and `j` result are installation facts reported by the operator. Do not replace them with a factory key table. A connector label, a host key, and a song action are separate identities.

The spinner initially occupied the wrong header row. Correcting that physical connection restored relative Y reports without changing firmware or input configuration. No persistent configuration or stored LED script was written during this session.

## Confirmed intended behavior

- The operator expects controller inputs to appear as keyboard events, with direction and distance updates for the knob. Verify the actual SpinTrak/controller configuration and host reports before choosing an adapter. Intended behavior is not a measured USB report format.
- The foot pedal controls BPM through beat taps. For 6/8, the operator confirmed chart and pedal counting as `1 2 3 4 5 6` in eighth-note beats. Tapping can begin on any beat; the first tap does not identify a downbeat or reset transport position. Device key mapping and unprovided tempo-estimation details still need confirmation.
- Other control purposes vary by song. The knob is not globally assigned to gain. Button labels may become colours such as Red, Blue, Yellow and Green; identifiers should remain consistent across songs without encoding voice identity or a fixed action.
- Lights are the LEDs built into the arcade buttons. Browser pads should follow the same semantic lit, pulse, blink and trigger behavior.
- Pending actions and recording need distinct pulse/blink patterns. Which state uses which pattern is not yet confirmed. Single-use triggers need a rapid attack, brief hold and decay; no numeric envelope has been selected.
- Output follows the corresponding peripheral's cadence. Consumers handle smoothing appropriate to physical LEDs or browser pads. Do not invent a fixed update rate or PWM capability.

These requirements come from the operator's [PR #3 review](https://github.com/anulman/show-tools/pull/3). They supersede the plan's fixed gain-knob assignment and arbitrary output-cadence proposal.

## Facts still requiring confirmation

Consult manufacturer documentation for product capabilities. Ask the operator about the actual installation, controller configuration, operating system, chosen key mappings, firmware/settings, and available electrical connections wherever these affect the proposed integration. Obtain the facts before specifying the dependent protocol, wiring or driver design. Do not fill gaps with plausible defaults.

A simulator may model explicitly declared inputs and outputs, but its success does not verify physical reports, LED control or wiring. Identify unsupported assumptions and blocked steps in the plan rather than presenting them as implemented capabilities.

## Arcade-button CAD reference

The operator confirmed the four 100 mm buttons are the same model in red, green, blue, and yellow on October 28, 2026. The [CAD workspace](../hardware/cad/README.md#inspect-the-100-mm-buttons) provides a pinned Adafruit 1185 manufacturer model for provisional family reference. It has invalid upstream geometry and does not establish measured fit. The [measurement worksheet](../hardware/cad/components/adafruit-1185/README.md#mechanical-facts-still-needed) records the remaining mechanical facts and housing choices.

## I-PAC enclosure measurements and cable routing

Operator measurements supplied November 4, 2026:

| Item | Inches | Millimetres | Evidence limit |
| --- | --- | --- | --- |
| Ultimate I/O PCB length | 5 3/16 | 131.7625 | Operator measurement |
| Ultimate I/O PCB width | 2 5/8 | 66.675 | Operator measurement |
| PCB elevation above the mounting floor on installed feet | 5/8 | 15.875 | PCB face datum and thickness unspecified |
| Selected internal enclosure height | 3 | 76.2 | Design clearance budget, not measured component height |

The operator considers 2.5 inches of interior height probably sufficient and prefers 3 inches for clearance. The mounting feet currently use wood screws. Foot screw positions, foot footprints, exact plug poses, and cable bundle dimensions remain unmeasured; the enclosure floor can remain undrilled for a later fitted mounting solution.

The enclosure needs internal room for the existing daisy chains. The stated cable routes are USB to the music host, 5 V LED power, four arcade buttons with four conductors each, a mushroom button with two conductors, and a spinner with four conductors. These counts describe enclosure routing, not new electrical connections or musical bindings. Direct socket access and separate device channels are alternatives under consideration. Proposed seam openings and cable-storage bay dimensions are design allowances until the actual harness is checked.

## Mushroom mounting confirmation

On November 4, 2026, the operator accepted an approximately 0.9-inch straight mounting hole and confirmed that no counterbore is required. The existing 23 mm hole is approximately 0.906 inches. The operator measured the threaded-body region with the supplied nut at approximately 7/8 inch diameter and the upper mounting flange at approximately 1 1/8 inches. The flange rests on the 4 mm roof and the stock nut clamps beneath it. These approximate part measurements and design acceptance do not establish a completed physical fit test.

On November 4, the operator reported that the mushroom assembly needs at least 1 7/8 inches of internal space and chose a 2-inch minimum for clearance. These correspond to 47.625 mm and 50.8 mm. The selected Leo candidate has 55 mm of central vertical clearance from the cover's inside floor to the roof underside, exceeding the chosen minimum by 4.2 mm. Its height remains unchanged; this local height check does not establish connector bending space or complete physical fit.

## EliteDesk audio interface

Pi's read-only inspection on November 6, 2026 identifies the Focusrite Scarlett Solo USB by serial `Y7PZ8TB58373E7`, USB vendor `1235`, and product `8211`. Its stable control link is `/dev/snd/by-id/usb-Focusrite_Scarlett_Solo_USB_Y7PZ8TB58373E7-00`. The observed ALSA card ID is `USB`, hardware device `0`. Card index `1` and USB bus address are current observations and can change after reconnect.

The approved trial negotiated capture and playback at 48,000 Hz, `S32_LE`, two channels, 256-frame periods, and 1,024-frame buffers. Capture channel `0` is physical microphone input `1`. The operator has level-checked the microphone and speakers and requests unity gain.

The named MIXER control `Direct Monitor Playback Switch` is BOOLEAN with one value and was read as off. Its observed numid is not a stable identifier. The separate user unit `scarlett-monitor.service` was loaded but inactive/dead, with MainPID `0` and no control group. Application audio admission must check device identity and this monitoring policy on every fresh enable. It must not change another service or the mixer implicitly.
