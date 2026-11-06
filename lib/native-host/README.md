# Native performance host

`native_fake_host` runs the engine with synthetic input for offline development. `--step` advances audio only on explicit test commands. `native_alsa_host` connects the same engine and IPC service to ALSA capture and playback on Linux. It requires explicit device names, rate, channel count and input index, block size, period and buffer sizes, and sample format. Choose stable device names for the installation and verify them on the target machine.

```sh
cmake -S lib/native-host -B /tmp/native-host-build
cmake --build /tmp/native-host-build
ctest --test-dir /tmp/native-host-build --output-on-failure
/tmp/native-host-build/native_alsa_host SOCKET SAMPLE_RATE BLOCK_FRAMES MAX_VOICES MAX_SECONDS CAPTURE_DEVICE PLAYBACK_DEVICE CAPTURE_CHANNELS INPUT_CHANNEL PERIOD_FRAMES BUFFER_FRAMES s32|float
```

The socket directory must be private and owned by the caller. The audio owner reads the selected capture channel, processes frames in the native engine, and writes stereo playback. Stop and panic discard pending host and device output. Device errors terminate the host. The gateway can reconnect while a run remains active. Opening or running the ALSA host accesses the selected physical devices. Building and testing it do not.

The ALSA backend's dependency and license are described in [its README](../native-alsa/README.md). Hardware configuration and physical audio behavior require separate verification on the target machine.
