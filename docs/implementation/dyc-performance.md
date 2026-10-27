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

Samples start at 100%. Cowbell's successive captures retain distinct variants and automatically select the matching marked sound without double taps. These operator answers are encoded in the compiler/mapping and are not open questions. The current source supplies three distinct cowbell patterns, all representable by that rule.

The subsequent answers are encoded in [the answered-semantics design](dyc-answered-semantics.md): capture cutoff, silent-source remainder, loop period, phase join, matching doubled groups, actual-frame starred tempo intent, configurable ±25 ms windows with rejected ties, and deferred `d`. Chorus-on-knob follow-on remains behind the capture/A target.

In 6/8, chart cues and pedal taps count six eighth notes. A tap can start on any beat and does not establish a downbeat or reset phase. DYC's current A section is 4/4. Unused hardware, LED waveform, or Video scene decisions do not block its keyboard path.

## Integration evidence and holds

The compiler's executable import boundary validates reciprocal capture references, declared capture/loop spans, explicit groups, unique chart columns, selection readiness, and disjoint recording intervals. Earlier arming for a future interval is legal. The native loader independently validates the numeric graph. ABI 4 exposes version 2 tables, portable loading, and tempo observations. Release and sanitizer suites exercise PCM and allocation guards. Joint WASM tests cover capture, phase joins, evolving history, fractional release, output stems, and venue-bank reuse.

The practice desk includes staged source/artifact import, inspection, audio-device selection, and the isolated peripheral adapter. Keyboard command IDs preserve producer/session/sequence identity. After focus loss, fresh non-repeating DOM keydown events perform immediately; held-key and repeat suppression remain active. Raw hardware reconnects retain their unknown-until-release contract. Physical mappings, knob effects, and phase-preserving pedal tempo remain unbound.

The baseline full A run rejected F21 in both hosts at 44.1 and 48 kHz. The guard incorrectly conflated arming with recording. The corrected requirement permits F21 preparation while R1 records, with separate live-route, capture, and reservation owners. The saved failure report is baseline evidence for that software correction; the operator's source needs no edit. The branch stays draft until actual A execution and independent software review pass. Live browser/microphone/MP3 checks are first-operator-test steps when computer access is unavailable, not a circular prerequisite to making validated software available. No Chrome/CDP process was started. Voice racks retain independent state and one stopped venue definition.
