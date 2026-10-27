# Source manifest

Reviewed 27 October 2026. Product pages describe capabilities; they do not identify an uninspected unit's revision, programming, or terminal orientation.

| Source | Facts used | Boundary |
| --- | --- | --- |
| [I-PAC Ultimate I/O](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) and [wiring drawing](https://www.ultimarc.com/images/1/uiowiring_sm.png) | Supplied switch harness, ground-referenced switches, keyboard modes, direct spinner, separate 5 V centre-positive 5.5/2.1 mm LED supply | Use the Ultimate I/O harness section. The page also contains generic screw-terminal and I-PAC 2 instructions. No invented connector view. |
| [Firmware 50 modes](https://www.ultimarc.com/MultiMode.pdf) | Ten-second shift-plus-button holds can change persistent mode | Guide avoids the chord and uses brief combination tests. Actual firmware remains unknown. |
| [Adafruit 1185](https://www.adafruit.com/product/1185) | Representative button, normally open switch, 0.187-inch switch tabs and 0.25-inch LED tabs, resistor-equipped LED up to 12 V | Rounded metric sizes are 4.8 and 6.3 mm. No assumed actual insert current or polarity. |
| [Adafruit 423](https://www.adafruit.com/product/423) | Momentary pedal supports NO and NC use, 2 m cable | No conductor colours or contact numbering established. Disconnected continuity test selects NO pair. |
| [Addison NPB22-M611R](https://addison-electronique.com/en/momentary-push-button-switch-mushroom-head-n-o-n-c-red.html) | Operator identifies momentary NO/NC mushroom, use NO | Page returned HTTP 405. No manufacturer-verified pin numbers claimed. |
| [SpinTrak](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/) | Separate direct-controller version supports Ultimate I/O | Opti-PAC cut-and-strip instructions do not apply. Raw axis, sign, scale, and plug orientation remain observed facts. |
| [Adafruit 1466](https://www.adafruit.com/product/1466) | Regulated 5 V, up to 4 A, positive-tip 5.5/2.1 mm supply | Nominal match does not prove button/driver compatibility or an actual unit's polarity. |
| [L7A](https://www.ultimarc.com/control-interfaces/accessories/9-led-single-color-connection-pack-for-i-pac-ultimate-i-o-interface/) and [daisy-chain harness](https://www.ultimarc.com/arcade/button-accessories/daisy-chain-harness/) | Nine leads plus common, 560 mm; separate 6.3 mm LED-common chain | Four positions used by operator. Distinct from switch ground. |
| [L4B extension harness](https://www.ultimarc.com/output/led-and-output-controller-accessories/extension-harness-pack/) | Ten replacement 4.8 mm wires, 600 mm | Dedicated page supports 600 mm despite a differing controller-page summary. Measure actual layout. |
| [Adafruit 3786](https://www.adafruit.com/product/3786) | Three-pack bare-wire joints | Operator has two packs. Check actual wire size against joint instructions. Quick-disconnect tabs do not insert into these joints. |
| [CAPFEET](https://www.ultimarc.com/output/led-and-output-controller-accessories/pcb-mounting-feet/) | PCB feet with screws | Operator has four. Verify actual mounting fit. |
| [Apple accessory approval](https://support.apple.com/en-ca/102282) | Unlock and allow accessories on supported Apple silicon laptops | Power can be present without approved data access. No measured adapter compatibility. |
| [Apple System Information](https://support.apple.com/guide/mac-help/get-system-information-about-your-mac-syspr35536/mac) | Option + Apple menu opens System Information | USB enumeration and key response have separate acceptance checks. |
| [Apple Keyboard Viewer](https://support.apple.com/guide/mac-help/use-the-keyboard-viewer-on-mac-mchlp1015/mac) | Input menu and Keyboard settings route | Menu labels vary by macOS release. Text alone does not establish release or nonprinting inputs. |

The complete inventory and MacBook adapter target come from the operator's hardware-guide request. Custom pods, mounts, enclosure, strain relief, and disco-ball support are fabrication requirements, not selected commercial products or verified drawings.

The optional probe commands match `lib/peripherals/README.md` and the native probe CLI. The guide author did not execute `list`, `listen`, or `led`. Existing software tests do not verify wiring.
