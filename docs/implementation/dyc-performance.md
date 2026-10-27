# DYC implementation checkpoints

The acceptance target is the current public DYC A section, bars 1 through 76, running in the existing practice desk with keyboard controls and effected capture, commit/autoplay, cached playback, and processed downloads. Compiler-only output is not completion. Hardware is optional. Authors do not merge PRs. The operator has authorized the coordinator to land independently reviewed, validated integration work until the A-section test is ready.

The implementation branch starts on effects integration `ab56a67`, preserving its ABI 2 stems, monitoring predicate, live authorization latch, and fault fix. The merged PE plan at `6271110` supplies scope. PE owns shared performance, sampler, bridge, and practice UI changes. Filters owns `lib/patches/`. Peripherals owns its isolated input/feedback package. Video owns its renderer and assets.

## Ground and sketch

The existing engine copies one cue per button/bar, then resolves actions and audio boundaries in C++. The new chart needs separate cue applicability and execution positions. It also needs immutable takes independent of buttons. The existing sampler's loop trigger stops other voices on its sample channel, so repeated variant triggers on one channel cannot implement layering.

Two architecture candidates were compared. Both chose bounded native domain tables rather than a general virtual machine. The selected design extends the existing performance engine with stopped program preparation and tick/action/resource tables. It takes explicit take-set selections and separate press windows from the second candidate. It preserves one native clock and process path. It does not add JavaScript beat handlers.

The compiler consumes frozen cell values/notes and an explicit mapping. Its artifact preserves source coordinates, logical voices, takes, selections, cue times, action times, diagnostics, and digests. Unknown semantics remain visible and block only the corresponding required executable instructions.

## Verified units

1. Fetch and import public CSV and note-bearing worksheet data through shared browser/CLI code. Verify values, notes, worksheet identity, and deterministic source serialization.
2. Compile current DYC into a source-located semantic artifact and inspection report. Exercise unknown notation and mapping errors before runtime loading.
3. Prepare native takes and bounded pending actions while stopped. Verify fractional actions, commit/autoplay, retained layers, selected variants, gain/mute, and Stop/Panic with real PCM in native and WASM builds.
4. Integrate processed capture using Filters' prepared cache API. Process live audio once and retain original source plus processed results and DSP state. Playback evolves the effect history from original source across loop iterations. Never process baked PCM or reset DSP history on wrap. Verify release tails, exact loop intervals, and processed downloads together.
5. Load/refresh artifacts in the existing practice desk. Exercise the full A section with browser keyboard controls, inspect narrow/desktop layout, and deliver exact fetch/compile/start/test commands and a runnable preview.

Each verified unit is committed. Changes that fail their behavioral check are corrected before stacking more work on them. A source edit must produce a source-located semantic diff and a native testable expectation.

## Current facts and scoped blockers

The fresh October 27 export has 55 rows and 220 columns. A runs through bar 76 before Intro B1. Cowbell now uses `rb/crb/crb/cb`; old `cl/clr` behavior is not required by this source. The meter cell now displays `4/4`. CSV displayed values and XLSX stored values can differ because spreadsheet formatting affects meter text.

The operator's latest October 27 answers supersede the earlier merged-plan interpretation. Arming immediately switches live processing to the target voice stack, while capture stores audio only from the declared recording boundary. Reject overlapping armed or recording captures atomically without disrupting the existing capture. Effect history evolves across loop iterations. Retain original source and DSP state, never apply effects to already-baked PCM, and never reset history on wrap. Cache loop seams and release representation are technical verification work. These choices are settled and are not blockers.

Operator questions are pending for `2c3`, the star in `1p*`, layer balance/selection and cue proximity, and whether knob `d` spans are defined or explicitly deferred for this milestone. No answer is inferred from the old parser. Chorus-on-knob follow-on stays behind the capture/A-section target and needs its own missing gesture/mapping facts.

In 6/8, chart cues and pedal taps count six eighth notes. A tap can start on any beat and does not establish a downbeat or reset phase. DYC's current A section is 4/4. Unused hardware, LED waveform, or Video scene decisions do not block its keyboard path.
