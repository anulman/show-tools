# Mac I-PAC bench observations

The operator confirmed these results during the MacBook wiring session and follow-up on 2026-10-28. This record supplements the original [PDF verification](verification.md).

## Physical observations

- The mounted I-PAC enumerated as USB vendor `d209`, product `0410`. It exposed keyboard, relative mouse, and LED interfaces.
- Native input capture showed signed relative Y motion, HID usage page `1`, usage `0x31`. The raw mouse report used report ID `3`, with signed little-endian 16-bit X and Y fields. X stayed zero during the successful spinner test. Units remain uncalibrated HID counts.
- The operator confirmed clockwise motion moves the Mac cursor down and counterclockwise moves it up. The raw capture was not annotated by physical direction.
- The operator identified the switch plug producing `j` as `2a`. The complete connector-to-key map remains unfinished.
- Moving the spinner plug to the correct header row restored input. No firmware or persistent configuration change was needed.
- With external power only, the onboard LED sequence visibly lit the button connected to output 1. Reconnecting USB preserved visible light. The operator confirmed its current polarity works.
- Temporary native diagnostics sent the SDK group-1 enable report `03 81 01 00 00` and channel-0 brightness reports. The operator saw three stepped pulses, then four smooth cosine pulses with a requested period of 2.4 seconds. The smooth demonstration began and ended fully on and used 100 brightness steps per cycle.
- The operator accepted the smooth demonstration. This does not assign that shape or period to a musical state.

Both LED orientations were tried before the successful onboard-script test. Earlier host writes returned success while the LED remained dark. The session did not isolate a single cause. It did not establish that the separate enable command was necessary. Preserve the successful sequence without turning the troubleshooting history into a claimed electrical diagnosis.

## Packaged diagnostic and automated coverage

The original working helpers and captures were temporary files outside the repository. The checked-in `led-on` and `led-pulse` commands reproduce their report sequence and pulse shape through the existing guarded Mac and Linux transports. They replace one eight-output enable mask and disable the selected output's seven peers.

The current `led-pulse` command adds an off request after the four cycles. It also attempts off once if a pulse brightness write fails. This follows the operator's default-off policy for idle LEDs and completed tests. The historical observations below describe the earlier demonstration that ended at full brightness; the new final-off behavior still needs a physical repeat.

Automated tests open no devices. They cover exact SDK enable reports at group boundaries, selected-channel brightness, explicit off without a mask change, invalid requests, failed enable and brightness writes, CLI confirmation refusal, and monotonic fades through four cosine cycles. The existing portable native/WASM and performance fixtures remain separate checks.

Physical success applies to the temporary Mac bench diagnostic. The packaged commands need an operator-run repeat before claiming their complete hardware path is verified. Linux hardware behavior and exact USB or visible pulse timing have not been measured. No persistent firmware, input-map, or stored-script writes were made.

## Next bench session

The selected arcade input plugs are `1a`, `2a`, `1b`, and `2b`. Complete their physical button identities and raw key map without assuming factory defaults. Verify the other three LED polarities and output indices. Connect the foot pedal and normally open mushroom contact, then capture their press and release behavior individually.

Use [Resume the Mac bench test](resume-bench.md) for the procedure. The [inventory](../../hardware-inventory.md#installed-bench-state) owns the current installation facts.

## Verification of this milestone

Run from the repository root:

```sh
node --import tsx lib/peripherals/scripts/verify.ts /tmp/ipac-bench-handoff-build
```

On the MacBook checkout, the CMake build and all 14 CTest cases passed. Native and WASM fixtures agreed on 84 observations, and all three capture-summary tests passed. The complete pulse sequence also ran against an in-memory transport: one enable report followed by 401 brightness reports, with four troughs and a final level of 255. These checks opened no devices. CLI help and invalid requests also opened no devices.

The Markdown links were checked for existing local file targets, and `git diff --check` passed. The original PDF was not changed or regenerated. Packaged hardware execution and Linux compilation remain follow-up checks, separate from these local results.
