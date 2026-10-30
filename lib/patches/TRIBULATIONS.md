# Tribulations guitar

`make_tribulations_guitar(sample_rate)` creates the fixed, operator-approved **Legato fuzz** patch. The canonical effect preserves the V7 study's string, moving filter, amp, and exact parameters. Its descriptor type is `tribulations_guitar`, version 1. It has no public editable parameters.

```cpp
#include "tribulations_guitar.h"
std::unique_ptr<patches::Effect> stages[]{patches::make_tribulations_guitar(48000)};
auto rack = patches::Rack::create(stages, 1);
```

Preparation accepts finite sample rates from 16,000 through 192,000 Hz and returns null on failure. Stereo input becomes its arithmetic channel mean. Output is the same synthesized signal on both channels. Nonfinite input channels become zero before processing. No raw voice is mixed into the output.

The factory is available in the standalone C++ patches library. The practice desk, voice catalog, and compiled performance protocol do not yet expose this effect. No voice assignment, production graph type, or musical cue is implied by its name.

## Signal and state

The string detects continuous pitch and pluck articulation from the source. A fractional-delay Karplus–Strong string produces new sound. A resonant filter follows the synthesized string's envelope, then a biased nonlinear amp and cabinet low-pass produce the garage sound. The patch does not extract vocal formants, snap notes, or transpose pitch.

The tracker searches 80–1,000 Hz after a rate-scaled FIR and conversion to an 8 kHz analysis stream. Out-of-range periodic input can produce octave estimates inside that range. Low-level or unvoiced input can fail to excite the string. Pitch glides use a 6 ms coefficient. Attack handling waits at least 28 ms for pitch and expires after 80 ms. The descriptor's zero fixed delay does not promise zero response time. Physical monitoring latency is unmeasured.

The exact fixed values are in `src/tribulations_internal.h`:

| Stage | Parameters |
| --- | --- |
| String | decay 2.2 s, brightness .62, pick .95, output 1.8 |
| Moving filter | input HP 90 Hz, drive 1.5, attack 2 ms, release 180 ms, envelope sensitivity .006, resting cutoff 350 Hz, sweep 2.4 octaves, Q 1.25, band mix .60, post LP 4,600 Hz, output 1.3 |
| Garage amp | drive 36, grit 1, bias .18, tone 4,000 Hz, output .06 |

Snapshots include pitch analysis, pending attacks, the seeded excitation generator, the string ring, both filter channels, envelopes, amp state, and silence counters. Prepared processing, state copies, reset, capture, and playback allocate and free no C++ heap memory. Preparation, snapshots, and destruction occur outside audio processing. `memory_bytes()` includes the internal rack and its owned buffers.

The string gates and resets after two seconds of consecutive exact-zero input. Filter and amp each have a one-second exact-zero cap. The composite release bound adds these caps as `ceil(2 * rate) + 2 * ceil(rate)` frames. Existing tails run through downstream stages until those bounds. These are explicit truncation caps, not naturally finite decay or a promise that audio lasts four seconds. Host Stop/Panic policy remains separate.

The patch supports the existing original-source capture and evolving playback contract. Printed first-pass PCM never enters its own effects. The complete graph can resume from the actual capture endpoint. Wrap rewinds source without resetting DSP history. Aliasing, physical callback deadlines, and equivalence to an original guitar or amplifier remain unmeasured.

## Verification

`node --import tsx scripts/verify-patches.ts` runs both patches test executables natively and through Emscripten and compares their stereo fixtures. `tribulations_guitar_tests` covers frozen approved PCM probes, independent output pitch, continuous bends, quiet and strong articulation, centered mono, arithmetic downmix, pending and warm snapshots, reset, original-source capture, evolving wraps, endpoint handoff, release, rate admission, and native C++ heap activity.

Extraction was compared directly with study commit `d009909`: all 207,270 synthetic frames at 44.1 kHz, 225,600 synthetic frames at 48 kHz, and 501,120 frames from the authorized operator take at 48 kHz were exactly equal. Each comparison includes a 4.2-second zero-source suffix. Those private source files and renders are not repository fixtures. The committed synthetic probes preserve small, reproducible samples of the approved sound without retaining private recordings.

## Lessons from the listening study

The target was the guitar solo at 2:25–2:55 in LCD Soundsystem's *Tribulations*. The operator chose a plucky, twanging, metallic garage tone, then selected **Legato fuzz** over the other sustained versions. This preference is the canonical baseline. It is not a measured exact match to an isolated guitar stem.

- Fit the actual performer early. Synthetic vowels favored a sharper pick; the supplied voice favored fuller body and longer, connected sustain.
- Preserve source gain. FFmpeg's default stereo downmix boosted this particular recording by roughly 3 dB. An explicit channel mean avoided changing articulation and distortion before evaluation.
- Compare at matched loudness, with headroom. The listening clips used static gains. Those audition gains are not the live patch's fixed output trims.
- Include exact duplicate clips in model listening rounds. One subtle-change round was inconclusive. A later round correctly grouped duplicate references and preferred the two sustained candidates without distinguishing them. Operator feedback resolved that tie.
- Treat listening descriptions as judgments, not DSP evidence. Model claims about vocal formant mapping or original gear did not establish how either recording was made.
- Measure the property under test. With distortion present, a closing filter can have a rising harmonic centroid. Isolated filter motion and full driven sound require different probes.
- Preserve complete state. Pitch analysis and excitation history matter as much as delay and filter history when capture, replay, and release must agree.

The ephemeral listening workflow used an explicitly authorized private WebM and Google Gemini audio comparisons. Credentials stayed outside files and logs. Private recordings, model payloads, derived PCM, and audition exports are not required to build or use this canonical effect.
