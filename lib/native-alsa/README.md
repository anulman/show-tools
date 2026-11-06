# Native ALSA PCM device

`AlsaPcm` opens capture and playback with explicit device names, sample rate, capture channel count and input index, sample format, period size, buffer size, and maximum block size. Playback has two interleaved channels. Both streams use the requested rate and format. The backend disables ALSA rate resampling and rejects unsupported hardware parameters.

The caller owns the device on its audio thread. `read` copies the selected input channel to mono float PCM. `write` accepts interleaved stereo float PCM. Both return the number of frames transferred or a negative ALSA error. The caller retains unwritten frames and decides whether to call `recover` after a device error. `drop` discards queued device PCM; `prepare` prepares both streams for another run. Buffers are allocated during `open` and are bounded by `max_block_frames`.

Linux builds require ALSA development headers and libasound. macOS builds provide an unavailable-device stub and run the simulated ALSA boundary test. No test opens physical hardware.

```sh
cmake -S lib/native-alsa -B /tmp/show-tools-alsa-build
cmake --build /tmp/show-tools-alsa-build
ctest --test-dir /tmp/show-tools-alsa-build --output-on-failure
```

The device names, format, channel selection, and buffer settings are installation configuration. The simulated test does not verify a physical interface or ALSA driver.

## System dependency and license

Linux links the installed `libasound` shared library. Upstream provides its [LGPL 2.1 license](https://github.com/alsa-project/alsa-lib/blob/master/COPYING). This repository adds an adapter and does not copy the ALSA implementation. Runtime distribution must identify the system library and retain its required license notices. The native performance engine's manual clock remains independent of aubio.
