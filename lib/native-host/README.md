# Native audio host foundations

This module supplies a preallocated PCM pump, a stopped instrument lifecycle, bounded single-producer queues, and private message framing for the future native device service. It links the existing shared C++ performance engine without changing its ABI or musical behavior. It does not yet provide a daemon, network producer, or working remote performance desk.

`AudioPump` clears four planar stem buffers, processes mono input through `pf_process_stems()`, and sums sample/click and processed-live stems once into interleaved stereo. Partial writes retain the unwritten suffix. Rendering again before that suffix is consumed rejects, so a device retry cannot advance musical time twice. Stop discards pending output.

`Instrument` gives one caller ownership of the engine and pump. Song and effect preparation run while stopped. Song replacement prepares a candidate engine before replacing the previous one, so an invalid packet preserves the prior instrument. Configuration and preparation may allocate. The prepared processing path uses existing storage.

The device boundary is separate in [native-alsa](../native-alsa/README.md). Device identifiers, channels, format, buffers, and recovery policy require explicit configuration. No hardware settings, real-time priority, latency guarantee, or deployment service is established by these libraries.

## Build without device access

Use a C++17 compiler and CMake 3.20 or newer.

```sh
cmake -S lib/native-host -B /tmp/show-tools-native-host -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-native-host --parallel
ctest --test-dir /tmp/show-tools-native-host --output-on-failure
```

Tests exercise actual engine PCM, capture, effects, playback, variable block sizes, short writes, stopped replacement, message bounds, and queue ordering. They open no audio devices. The CI workflow builds both native modules on Linux and macOS. Linux requires ALSA development headers and compiles the actual device implementation. macOS uses the unavailable-device stub and simulated ALSA tests. Neither path establishes physical Scarlett operation.
