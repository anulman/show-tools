# Native performance host

`native_fake_host` runs the engine with synthetic input for offline development. `--step` advances audio only on explicit test commands. `native_alsa_host` connects the same engine and IPC service to ALSA capture and playback on Linux. It requires explicit device names, rate, channel count and input index, block size, period and buffer sizes, and sample format. Choose stable device names for the installation and verify them on the target machine.

```sh
cmake -S lib/native-host -B /tmp/native-host-build
cmake --build /tmp/native-host-build
ctest --test-dir /tmp/native-host-build --output-on-failure
/tmp/native-host-build/native_alsa_host SOCKET SAMPLE_RATE BLOCK_FRAMES MAX_VOICES MAX_SECONDS CAPTURE_DEVICE PLAYBACK_DEVICE CAPTURE_CHANNELS INPUT_CHANNEL PERIOD_FRAMES BUFFER_FRAMES s32|float
```

The socket directory must be private and owned by the caller. The audio owner reads the selected capture channel, processes frames in the native engine, and writes stereo playback. Natural completion writes the final host block and drains queued playback before another start is accepted. Stop and panic discard pending host and device output, including during the drain. Device errors terminate the host. The gateway can reconnect while a run remains active. Opening or running the ALSA host accesses the selected physical devices. Building and testing it do not.

The ALSA backend's dependency and license are described in [its README](../native-alsa/README.md). Hardware configuration and physical audio behavior require separate verification on the target machine.

Managed servers append `--owner-pid PID` to either executable. The host verifies its actual parent before acquiring devices and exits if that parent dies. Linux uses parent-death signaling with a race check; the portable synthetic path watches parent identity. A forged owner is rejected. Standalone offline callers may omit the option. The persistent desk owns its native child; stopping musical transport keeps that child and its takes, while terminating audio destroys it and releases devices.

The ABI 8 snapshot appends the complete `PF_LIGHT_FIELDS` engine light image after tempo readback. The native owner calls `pf_light_output()` at its existing observation cadence; network consumers relay those evaluated levels without advancing phase. The remote session schemas retain the image as required `NativePerformance.lights`, alongside state, host epoch and revision, including command results. Control 7 carries the unified cue button's physical edge value, 0 released or 1 held; cue selection and held-brightness precedence remain in PE.

Managed ALSA hosts also receive one complete option group:

```sh
--usb-identity BY_ID SERIAL VENDOR_HEX PRODUCT_HEX ALSA_CARD_ID PCM_DEVICE MONITOR_OFF_NAME
```

The managed profile requires this identity and derives its logical `hw:CARD=...,DEV=...` arguments from it. Native acquisition resolves the stable control link and nearest USB ancestor, checks serial, vendor, product, ALSA card ID and PCM ancestry, and derives numeric hardware endpoints. It reads the named MIXER control as a one-value BOOLEAN and requires it off. No mixer writes occur.

Both capture and playback are acquired nonblocking, so an existing PCM owner fails admission. Before readiness, native checks the actual retained handles' card, device and stream, then repeats USB-instance and Direct Monitor checks and verifies live handles again. Every failure closes acquired resources. Standalone callers without `--owner-pid` may omit the USB requirement for synthetic/offline testing; controller-managed ALSA cannot omit it. Duplicate or partial option groups are rejected.

These checks run on every fresh enable. They do not provide an atomic USB-serial transaction or prevent another actor changing the mixer after admission. A disconnected device faults; the host never reopens a replacement automatically. Real target hotplug, negotiated parameters and device release require installation acceptance.
