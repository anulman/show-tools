# Practice desk contract

The practice desk is a static website. Browser audio controls and state use the local WASM/worklet bridge. Practice makes no relay API requests. Song modules live in top-level `songs/`, outside `ui/` and `lib/`.

## Timing ownership

The C++ WASM clock supplies authoritative beat crossings. The audio worklet owns count-in, song position, queued chart actions, capture boundaries, and loop playback. Rendering does not depend on UI timers or network responses.

Transport `phase` is `idle`, `count-in`, `playing`, or `ended`. Count-in uses the chart's lead-in column and has no numbered song bar. Displayed bars and beats start at one. Program beat offsets start at zero. Every Start begins a fresh count-in. A range loop wraps without another count-in. Tempo changes are accepted while stopped.

## Song controls

`SongScript` in `lib/performance/model.ts` contains an ID, parsed chart, `Program`, default practice range, and description. The registry in `songs/index.ts` loads each module on demand.

The current scripts compile their chart's lead-in and numbered-bar control rows with `compileChartControls`. The result is `Program.controls`, containing a `CueAction` for each channel in each column. Scheduled `Program.events` are empty. Samples are not preloaded.

Supported chart actions are arm, commit, commit-and-arm, stop, play, manual tap, and no action. During playback, `b` queues an action at the next bar crossing. During count-in, it targets the first song bar, including when count-in spans multiple bars. A blank cell is no action and cannot implicitly stop or play a channel. Unsupported notation is an explicit error.

Manual tap cues retain their notation and beat offsets for display. They play one hit per actual control press. `&a]` identifies the final half-beat and quarter-beat of the bar, 4& and 4a. It does not schedule two automatic hits. A missed tap leaves normal loop playback unchanged. If a loop was running before a tap, the worklet resumes it at the next bar after the manual phrase.

## Audio adapter

`audio.ts` exports `PracticeAudio`.

```ts
const audio = await PracticeAudio.create({ chart: song.chart, program: song.program });
const unsubscribe = audio.subscribe(state => render(state));
const detachEvents = audio.onEvent(event => observe(event));
await audio.enableMicrophone();
await audio.start({ bpm: song.chart.bpm, countInBars: 1,
	startBar: song.practice.startBar, endBar: song.practice.endBar,
	loop: true, automatic: false });
await audio.control({ id: 'R1' });
await audio.control({ id: 'knob', value: 0.7 });
await audio.control({ id: 'mushroom' });
await audio.dispose();
```

`snapshot()` and subscriptions return `PracticeState`. Each channel includes `ready`, `status`, gain, mute, and loop state. Status is `empty`, `ready`, `armed`, `recording`, `stopping`, or `looping`. Multiple channels can capture independently. The top-level recording field summarizes an active capture for transport display. Subscriptions supply an initial snapshot.

A pad press resolves its action from the active column. It is not a generic record toggle or loop toggle. Q/W form the upper row for L1/R1. A/S form the lower row for L2/R2. There is no foot control in the UI or control union.

Each channel's `light` comes from worklet state. An unused cue pulses when its loop is inactive. Armed actions, recording, and active loops glow steadily. A queued loop stop publishes a release duration so the glow pulses with diminishing strength until the stop boundary. Completed stops and transport stops extinguish the glow. Reduced-motion mode shows static indicators instead of pulses.

Commit starts the captured take looping at its exact boundary. Commit-and-arm also swaps in a preallocated capture buffer, so the prior take can play while the next take records. Explicit `x` stops immediately. `xb` stops at the next bar. Stop and mushroom cancel pending actions, commit active takes, and silence sample output and click. Stop also cancels a Start waiting for audio preparation.

Arm and commit-and-arm cues may carry a sparse capture hint with expected beat positions and a search radius. The worklet converts these to recording-relative frames using the active BPM. The recorder detects and trims each hit during capture. Sparse loops render only extracted clips, aligned to their expected positions. Manual taps select successive clips independently. Missing clips preserve their positions and report an error before a tap interrupts the running loop. Single-hit and multi-hit cues use the same path. Continuous captures have no sparse hint.

A `{ kind: 'bar', variantKey }` capture hint retains a named whole-bar take without extraction or silence trimming. `program.barPlayback` selects retained variants at the corresponding bar downbeats. It only replaces active loops and respects recording, mute, explicit stop, and missing takes. Dance Yrself Clean uses this path for its cowbell pair and single, with automatic double-bar playback at the charted `&a` marks.

Each pad has a volume slider that controls its channel gain between zero and one. Samples initialize at unity gain. Hardware knob events still control the selected channel. Mute changes active voices without resetting loop phase. Start requests microphone access and prepares output recording. The recorder waits through count-in and starts when the UI receives the first `playing` state. Stop, panic, and range completion finish the output take and release the microphone. Song changes dispose the old audio session before another program loads. Song click defaults off; lead-in clicks are mandatory and do not change that preference.

`outputStream` mixes rendered stereo output with the main live microphone for MediaRecorder. The voice branch downmixes microphone input to mono and feeds both recording channels. Mono input keeps unity gain; stereo input uses the standard left/right average. Sample stereo remains unchanged. The microphone branch connects only to the recording destination and does not add live voice monitoring to speaker output. Stopping or replacing microphone input and disposing the audio session disconnect this branch. A recording start in progress cannot create a second recorder.

Completed native WebM or MP4 recordings convert locally to stereo 192 kb/s MP3 in a separate worker. The browser capture state remains `stopping` through conversion, blocking another take and song switching. A successful export replaces the previous download. A failed export preserves the previous completed download. The lead-in is excluded by delayed recorder startup, while any enabled song click remains in the recording. Exported files and captured samples are memory-only.

## Events and desktop chart control

`PracticeEvent` contains `v: 1`, `runId`, increasing `seq`, `type`, and complete practice state. Types are `state`, `beat`, `control`, and `fault`. Beat events retain their source `frame` and `sampleRate`. The adapter adds spreadsheet ID, sheet ID, numbered-bar columns, and lead-in column metadata.

The main thread posts `{ kind: 'show-tools-performance', event }` to its own window origin. A same-window `show-tools-state-request` message returns the current snapshot envelope when audio exists.

The local CDP helper follows changed bar columns automatically for localhost practice pages. Hosted pages opt in by using **Open current bar in Sheets**. Following keeps only the latest pending column and does not activate Chrome. The Chrome extension provides a separate direct-tab option. Both implementations verify the visible song sheet and Name box. Neither integration owns the musical clock or serves as a dependency of mobile practice.

The standalone relay under `lib/relay/` retains a future hardware event contract. It is not connected to this WASM practice UI.
