# Audition shared patches reproducibly

Run the audition command from a checkout with Node, the project's installed dependencies, and a C++17 compiler available as `c++`.

```sh
node --import tsx scripts/audition-patches.ts \
  --source synthetic --rate 48000 --patch tribulations-guitar \
  --input-gain 1 --output-gain 1 --out /tmp/guitar-audition
```

For an explicitly selected file, replace `--source synthetic --rate 48000` with `--input INPUT.wav`. The file keeps its sample rate. Supported input is a nonempty standard RIFF WAV with one or two channels, PCM16 or float32 samples, and a rate of 44,100 or 48,000 Hz. Input is limited to 30 seconds and 16 MiB. Compressed audio, extended WAV encodings, and other rates fail with a conversion next step. No decoder, resampler, or substitute source runs automatically.

The native adapter calls the existing shared C++ factories for `tribulations-guitar`, `slapback`, or `chorus`. All use their canonical factory defaults. It averages stereo source channels arithmetically, applies the declared input gain, processes the effect, then applies the declared output gain. Both gains are required linear values from zero through sixteen. The dry control receives the same gains. Rendering supplies zero source through the effect's full declared release bound.

The command creates one fresh output directory containing:

- `source.wav`, the original mono arithmetic mean before gains.
- `A.wav`, the dry control with gains and a zero suffix matching the processed duration.
- `B.wav`, the selected patch output.
- `C.wav`, an exact byte duplicate of B.
- `manifest.json`, the declared labels, gains, source and renderer hashes, frame counts, PCM hashes, sample peaks, and RMS values.
- `provenance.json`, compiler, Node, platform, architecture, and the optional input filename.

Output uses stereo float32 WAV. The source copy is mono float32. The labels reveal each clip's identity, so this is not a blinded comparison. No loudness matching, automatic gain, limiter, playback, microphone access, or external upload occurs. Peak and RMS describe digital samples, not perceived loudness or true peaks. Overloaded or nonfinite output blocks publication and asks for revised gains. Existing output directories and source files are never overwritten.

A successful pack appears only after rendering and validation finish. Build scratch is removed on both success and failure. The semantic manifest has no timestamps or temporary paths. Compiler and machine details are separate because they can change between environments. Byte-for-byte reproducibility is checked for repeated runs in the same toolchain; numerical identity across arbitrary compilers and hosts is not claimed.

Run the tests with:

```sh
node --import tsx --test scripts/tests/audition-patches.test.ts
```

The tests render actual C++ effects, compare repeated packs at both supported rates, check exact duplicate controls, and independently verify a stereo impulse's arithmetic mean, gains, and Slapback repeat. Negative cases cover corrupt audio, missing tools, invalid arguments, full-scale overload, existing outputs, and cleanup. Test audio is synthetic. Packs are temporary working data under the project's retention policy.
