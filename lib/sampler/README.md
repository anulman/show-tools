# PCM sampler

The C++ engine in [src/sample_engine.cpp](src/sample_engine.cpp) owns sample PCM, capture buffers, retained variants, active voices, resampling, gain, mute, and mixing. Its public C interface is [include/sample_engine.h](include/sample_engine.h).

The [Performance Desk](../../ui/practice/README.md) uses that engine inside its shared audio worklet. Both WASM build scripts link it into the same module as the C++ clock, sequencer, and performance engine. The standalone native library builds the same source without aubio.

## Browser integration

[wasm-sampler.ts](wasm-sampler.ts) exports the `SampleEngine` and `SampleRecorder` bridges. They map channel and variant names to native IDs, transfer audio blocks, and read native metadata. PCM stays in the WASM heap. The former JavaScript sample engine and recorder are removed.

`AudioEndpoint` sends acknowledged commands over a MessagePort. `Sampler` attaches to an existing endpoint to decode and load audio files. Disposing that client does not close its borrowed endpoint or AudioContext.

`ui/practice/audio.ts` owns microphone acquisition and demo recording output. The [C++ performance engine](../performance/README.md) resolves chart actions and musical timing. Its `pf_process()` call executes capture, sequencing, playback, and click rendering. The practice worklet routes commands and formats native events. Samples begin empty and are recorded during practice. Commits start loops at the capture boundary.

Loop playback keeps the source speed. It does not stretch after a tempo change. Sparse capture detects attacks near hinted positions, trims tails against the pre-hit noise floor, and renders extracted clips at the expected beat positions. Competing sources or a sudden noise change can still confuse detection. Whole-bar capture hints retain all PCM and silence. Dance Yrself Clean uses those hints for its cowbell variants.

## Ownership and allocation

One caller owns each `st_engine`; its functions are not thread-safe. Native capture, rendering, triggering, starting, and committing do not allocate or free sample memory. Preparation and loading allocate buffers and reclaim retired buffers. Active voices retain the old take when another take replaces the channel's current sample.

The browser module has a fixed 256 MiB heap with memory growth disabled. Allocation failure reports an error instead of aborting the module. A failed load or preparation preserves the installed sample and prepared slot. The four practice channels share this memory with the clock, retained variants, and staging buffers.

Native diagnostic queries expose borrowed PCM pointers. The TypeScript bridge can wrap them in `Float32Array` views of WASM memory. These are not JavaScript-owned sample copies. Preparation, loading, or engine disposal can invalidate a borrowed view, so do not retain it as UI state.

The native interface supports 32 channel IDs and 16 retained variants per channel. Practice uses four channels. Default practice captures are limited to 30 seconds, with 32 playback voices. Heap capacity can reject a bank before those per-channel limits are reached.

Engine and source sample rates range from 1 to 384,000 Hz. Timeline frames must be finite and stay within the exact integer range of a double, including the end of a processing block. Invalid render or capture spans report `st_error` without changing the output or engine state.

The C header defines the query layouts. `scripts/generate-sampler-abi.ts` generates `wasm-abi.ts` during either WASM build, and the test suite checks that those constants match the header. `scripts/wasm-exports.ts` derives exported function names from the public C headers.

## Build and test the native sampler

Install a C++17 compiler and CMake 3.20 or newer. From the repository root, run these commands.

```sh
cmake -S lib/sampler -B /tmp/show-tools-sampler-build -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-sampler-build
ctest --test-dir /tmp/show-tools-sampler-build --output-on-failure
```

The `sample_engine` library and `sample_engine_tests` executable have no aubio or libsndfile dependency. This target tests PCM behavior. It does not open a microphone or speaker device and is not an EliteDesk service.

## Verify the WASM sampler

From the repository root, run these commands.

```sh
npm run build
npm test
```

The sampler and recorder tests use actual C++ WASM. Ownership tests check that stored PCM belongs to the WASM heap, uploads do not retain caller buffers, and replacement capture preserves a playing voice. Other checks cover sparse extraction, whole-bar variants, channel controls, fixed-heap exhaustion, and quantized practice behavior.

Native tests also cover frame boundaries, stereo resampling, old-buffer lifetimes, limits, sparse playback, and voice stealing. Browser audio-device behavior and hardware latency require separate checks.
