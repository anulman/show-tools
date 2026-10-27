# Practice desk contract

The practice desk is a static website. Browser audio controls and state use the local WASM/worklet bridge. Practice makes no relay API requests. Song modules live in top-level `songs/`, outside `ui/` and `lib/`.

## Timing ownership

The C++ performance engine owns clock advancement, beat crossings, count-in, song position, chart-action execution, generic sequencing, sample capture, playback mixing, and click generation. The browser worklet transfers input and output blocks through `pf_process_stems()` and publishes native events. It does not dispatch per-beat JavaScript callbacks. Rendering does not depend on UI timers or network responses.

Transport `phase` is `idle`, `count-in`, `playing`, or `ended`. Count-in uses the chart's lead-in column and has no numbered song bar. Displayed bars and beats start at one. Program beat offsets start at zero. Every Start begins a fresh count-in. A range loop wraps without another count-in. Tempo changes are accepted while stopped.

## Song controls

`SongScript` in `lib/performance/model.ts` contains an ID, parsed chart, `Program`, default practice range, and description. The registry in `songs/index.ts` loads each module on demand.

The current scripts compile their chart's lead-in and numbered-bar control rows with `compileChartControls`. The result is `Program.controls`, containing a `CueAction` for each channel in each column. `NativePerformance` converts the program to copied native instruction tables while stopped. Configuration is atomic; invalid replacement data preserves the previous program. The current scripts have empty scheduled `Program.events`. Samples are not preloaded.

Supported chart actions are arm, commit, commit-and-arm, stop, play, manual tap, and no action. During playback, `b` queues an action at the next bar crossing. During count-in, it targets the first song bar, including when count-in spans multiple bars. A blank cell is no action and cannot implicitly stop or play a channel. Unsupported notation is an explicit error.

Manual tap cues retain their notation and beat offsets for display. They play one hit per actual control press. `&a]` identifies the final half-beat and quarter-beat of the bar, 4& and 4a. It does not schedule two automatic hits. A missed tap leaves normal loop playback unchanged. If a loop was running before a tap, C++ resumes it at the next bar after the manual phrase.

## Audio adapter

`audio.ts` exports `PracticeAudio`.

```ts
const audio = await PracticeAudio.create({ chart: song.chart, program: song.program, compiled: song.compiled });
const unsubscribe = audio.subscribe(state => render(state));
const detachEvents = audio.onEvent(event => observe(event));
await audio.configureLiveEffects([]);
await audio.enableMicrophone();
await audio.start({ bpm: song.chart.bpm, countInBars: 1,
	startBar: song.practice.startBar, endBar: song.practice.endBar,
	loop: true, automatic: false });
await audio.control({ id: 'R1' });
await audio.control({ id: 'mushroom' });
await audio.dispose();
```

`snapshot()` and subscriptions return `PracticeState`. Each channel includes `ready`, `status`, gain, mute, and loop state. Status is `empty`, `ready`, `armed`, `recording`, `stopping`, or `looping`. Compiled capture permits one armed or recording owner; overlap rejects without changing that owner. Legacy channels retain their independent capture behavior. The top-level recording field summarizes an active capture for display. Subscriptions supply an initial snapshot.

A pad press resolves its action from the active column. It is not a generic record toggle or loop toggle. Q/W form the upper row for L1/R1. A/S form the lower row for L2/R2. There is no foot control in the UI or control union.

Each channel's `light` comes from native engine state. An unused cue pulses when its loop is inactive. Armed actions, recording, and active loops glow steadily. A queued loop stop publishes a release duration so the glow pulses with diminishing strength until the stop boundary. Completed stops and transport stops extinguish the glow. Reduced-motion mode shows static indicators instead of pulses.

Commit starts the captured take looping at its exact boundary. Commit-and-arm also swaps in a preallocated capture buffer, so the prior take can play while the next take records. Explicit `x` stops immediately. `xb` stops at the next bar. Stop and mushroom cancel pending actions, commit active takes, and silence sample output and click. Stop also cancels a Start waiting for audio preparation.

Arm and commit-and-arm cues may carry a sparse capture hint with expected beat positions and a search radius. C++ converts these to recording-relative frames using the active BPM. The recorder detects and trims each hit during capture. Sparse loops render only extracted clips, aligned to their expected positions. Manual taps select successive clips independently. Missing clips preserve their positions and report an error before a tap interrupts the running loop. Single-hit and multi-hit cues use the same path. Continuous captures have no sparse hint.

A legacy `{ kind: 'bar', variantKey }` capture hint retains a named whole-bar take without extraction or silence trimming. `program.barPlayback` selects retained variants at downbeats while respecting recording, mute, stops, and missing takes. Compiled songs use immutable take IDs and explicit selection membership instead. Their import boundary validates reciprocal arm/commit references, matching boundaries, and selection readiness before loading.

Each pad has a volume slider that controls its channel gain between zero and one. Samples initialize at unity gain. Actual peripheral knob direction/distance has song-specific meaning and is not mapped by this effects milestone. Per-effect venue tuning uses web controls. Mute changes active voices without resetting loop phase. Start requests microphone access and prepares output recording. The recorder waits through count-in and starts when the UI receives the first `playing` state. Stop, panic, and range completion finish the output take and release the microphone. Song changes dispose the old audio session before another program loads. Song click defaults off; lead-in clicks are mandatory and do not change that preference.

`configureLiveEffects(effects)` prepares an ordered default-live stack while stopped. The first type is `{ kind: 'slapback', delayMs, feedback, wet }`. Parameters and stage count validate before native preparation. The bridge owns a monotonic positive revision; native state confirms the applied resource. An empty list explicitly prepares identity processing. Failed preparation preserves the previous rack. Runtime edits reject without interrupting live audio.

Current `PracticeState.liveEffects` reports `prepared`, actual `active` authorization, `revision`, `stageCount`, and `captureSupported`. A valid Start with microphone ready authorizes live processing. Stop/Panic, end, fatal transport/render faults, and microphone loss clear the latch and live history. Readiness alone cannot rearm it. Compiled capture switches live routes on arm, records at its boundary, rejects overlap atomically, and permits `crb`. Prepared take banks preserve original source, printed stereo PCM, and evolving DSP state. Cached loops survive microphone loss. Legacy and generic raw capture reject with effects enabled; validation rejection is nonfatal.

`outputStream` mixes native sample/click and processed-live stereo outputs once each. There is no independent raw microphone recording branch. Mono reaches left/right equally before effects. Sample stereo remains unchanged. A separate live-monitor gain starts closed. `setMonitoringRelationship()` requires an active microphone and explicit physical-device facts. Different physical I/O devices or the same confirmed USB interface permit monitoring. Same non-USB hardware or unknown identity do not. Microphone replacement/loss, reported device or sink changes, Stop, and disposal invalidate confirmation. Downloads remain processed independently of that gate. A recording start in progress cannot create a second recorder.

The `NativePerformance` class transfers audio blocks and declarative song data to C++. The sampler and sequencer bridges map names and metadata to native APIs. None retain a JavaScript musical scheduler or sample bank. `pf_abi_version()` requires performance ABI 4. Compiled schema/packet 2 distinguishes capture end, loop end, and an explicit phrase anchor. A prepared endpoint Rack joins at capture end and consumes a declared zero-source suffix; the outgoing live rack does not duplicate that tail. Generated constants describe rows and layouts. The combined WASM heap is fixed at 256 MiB. Failed loading or preparation preserves the installed program. Prepared processing/control application does not allocate or reclaim C++ heap memory. Stopped configuration and preparation may allocate. JavaScript snapshots still allocate objects and arrays.

Numeric cue eligibility uses explicit milliseconds, initially 25 ms early/late, with equal-distance ties rejected. Prefixless cues remain column-scoped. Missed numeric cues do not toggle saved loops. `control({ id: 'tempo' })` and starred plays share one native, phase-preserving tempo-hit path. A star carries beat hint 1 and runs at the actual accepted press frame. Outer command retries cannot duplicate it. Playback readiness is preflighted before either starred outcome. Native `tempo-hit` events expose source, hint, and whether an estimate was available; fresh state also exposes the bounded latest-hit query. No physical pedal mapping is implied.

The offline build hashes JavaScript, WASM, and entry assets as one cache. A new cache installs completely before activation. Replacement activation and page reload wait until practice/startup/export is idle and no other practice window would be displaced. A failed installation leaves the old build intact. No manual cache clearing is required.

Completed native WebM or MP4 recordings convert locally to stereo 192 kb/s MP3 in a separate worker. The browser capture state remains `stopping` through conversion, blocking another take and song switching. A successful export replaces the previous download. A failed export preserves the previous completed download. The lead-in is excluded by delayed recorder startup, while any enabled song click remains in the recording. Exported files and captured samples are memory-only.

## Events and desktop chart control

The native engine queues up to 512 immutable events containing sequence numbers, transport state, and four channel states. `NativePerformance` formats them as `PracticeEvent` with `v: 1`, a host run ID, increasing `seq`, `type`, and complete practice state. Start resets the native event sequence for the new run. Native control deduplication retains command IDs as UTF-16 code units, including Unicode and embedded NUL identity. Types are `state`, `beat`, `control`, and `fault`. Beat events retain their source `frame` and `sampleRate`. The adapter adds spreadsheet ID, sheet ID, numbered-bar columns, and lead-in column metadata.

Effect status is queried into current snapshots and command receipts. Historical immutable events omit `liveEffects`; they do not claim a replayable effect revision at that earlier frame.

The main thread posts `{ kind: 'show-tools-performance', event }` to its own window origin. A same-window `show-tools-state-request` message returns the current snapshot envelope when audio exists.

The local CDP helper follows changed bar columns automatically for localhost practice pages. Hosted pages opt in by using **Open current bar in Sheets**. Following keeps only the latest pending column and does not activate Chrome. The Chrome extension provides a separate direct-tab option. Both implementations verify the visible song sheet and Name box. Neither integration owns the musical clock or serves as a dependency of mobile practice.

The standalone relay under `lib/relay/` retains a future hardware event contract. It is not connected to this WASM practice UI.
