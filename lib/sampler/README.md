# Microphone sampler and quantized audio patterns

Capture microphone PCM into named sample slots, then play completed takes immediately or on the next beat or bar. Recording boundaries, sample cues, and pattern events share the tracker's actual beat crossings in one AudioWorklet.

The browser interface is the [practice desk](../../ui/practice/README.md). The former standalone sampler demo is removed. Browser adapters and worklet assembly live under `ui/practice/`; reusable engines remain in this directory.

## Pattern data

Each pattern has an ID, a label, a positive integer `lengthBeats`, and events. An event's `atBeat` is a zero-based whole-beat offset smaller than `lengthBeats`. `sampleId` refers to an already loaded or recorded sample. `gain` defaults to 1.

```js
const pattern = {
	id: 'two-hits',
	label: 'Two hits',
	lengthBeats: 4,
	events: [
		{ atBeat: 0, sampleId: 'sample-a', gain: .9 },
		{ atBeat: 2, sampleId: 'sample-b', gain: .7 },
	],
};
```

Recordings capture bounded mono PCM at the AudioContext sample rate. File loading also accepts stereo audio and converts source sample rates with linear interpolation. Loops repeat the captured audio at its original speed. They do not stretch with later tempo changes. This version does not overdub a playing sample.

## Attach to the performance clock

Create the tracker from a user gesture. Give the sampler and sequencer one shared endpoint on a dedicated MessagePort. Keep `tracker.node.port` under BeatTracker ownership.

The following imports are source paths for a module at the repository root. Bundle the module before serving it. The worklet URL refers to the generated practice worklet, which also registers the shared `performance` processor.

```js
import { BeatTracker } from './ui/practice/runtime/beat-tracker.ts';
import { AudioEndpoint, Sampler } from './lib/sampler/index.js';
import { AudioSequencer } from './lib/sequencer/audio-sequencer.js';

const tracker = await BeatTracker.create({
	startingBpm: 120,
	wasmUrl: '/ui/practice/wasm/manual-clock.wasm',
	processorName: 'performance',
	workletUrl: '/ui/practice/practice-worklet.js',
	outputChannels: 2,
});
const channel = new MessageChannel();
tracker.node.port.postMessage(
	{ type: 'performance-connect', port: channel.port2 },
	[channel.port2],
);
const endpoint = new AudioEndpoint(channel.port1);
const sampler = new Sampler({ audioContext: tracker.context, endpoint });
const sequence = new AudioSequencer({ endpoint });
await tracker.setManual();
await tracker.startListening();

await sampler.startRecording('sample-a', { maxSeconds: 30 });
await sampler.stopRecording('sample-a');
await sequence.cue('sample-a', { quantize: 'bar' });
```

`Sampler` and `AudioSequencer` are independent wrappers. Immediate sample recording and playback can run without patterns. `Sampler.create({ audioContext })` creates a standalone sampler worklet. Standalone builds must publish `sampler-worklet.js` beside the generated wrapper. The practice desk uses a shared endpoint instead. Connect your input source to `sampler.node` to record with a standalone worklet. The standalone sampler does not acquire a microphone. Omitting `audioContext` creates an internally owned context.

## Sampler API

Sampler control methods return acknowledged promises. An acknowledgement confirms that the engine accepted the command. It does not mean playback or recording has finished.

| Method | Behavior |
| --- | --- |
| `startRecording(id, { maxSeconds = 30 })` | Start a bounded microphone take immediately and cancel its pending recording arm. |
| `stopRecording(id)` | Stop and save the active take immediately and cancel its pending recording arm. |
| `load(id, audioBuffer)` | Load a decoded AudioBuffer under an ID. |
| `loadPCM(id, channels, sampleRate)` | Load an array of mono or stereo Float32Array channels. |
| `loadURL(id, url)` | Fetch, decode, and load audio with the shared context. |
| `loadFile(id, file)` | Decode and load a browser File. |
| `trigger(id, { gain = 1, when = context.currentTime })` | Play a one-shot at AudioContext seconds. Late starts clamp to the next unrendered frame. |
| `stop(id)` | Silence this sample immediately and cancel its pending playback cue. Suppress automatic looping if its recording stop is armed. |
| `setVolume(value)` | Set the output gain. |
| `stopAll()` | Commit active recordings and clear sample voices. Use `AudioSequencer.stopAll()` to also cancel pending musical actions and patterns. |
| `snapshot()` | Return the latest sampler state. |
| `subscribe(listener)` | Supply state updates and return an unsubscribe function. |
| `dispose()` | Release this wrapper and resources it owns. |

`loadPCM` copies channel data before transfer. Caller buffers remain usable. Loading an existing ID changes future triggers. Load files while the performance is idle.

A sampler snapshot contains `ready`, `samples`, `recordings`, `looping`, `activeVoices`, `volume`, `channels`, and `metadata`. Each logical channel has an ID, gain, and mute state. `SampleEngine.setChannel(id, settings)` applies gain and mute during rendering, including to active voices, without resetting loop phase. `looping` contains the IDs of samples currently looping. `samples` contains records with `id`, `channels`, `length`, `sampleRate`, and `duration`. `recordings` contains `id`, `recording`, `frames`, `duration`, `maxSeconds`, `peak`, and `reason` for each recording slot. `ready` means the engine is available. A slot needs a completed take or file before playback.

## Audio sequencer API

| Method | Behavior |
| --- | --- |
| `armRecording(id, { action, quantize = 'bar', maxSeconds = 30, loop = true })` | Arm a recording `start` or `stop` on the selected crossing. A quantized stop starts the saved take looping by default. Replace that slot's previous recording arm. |
| `cancelRecording(id)` | Cancel that slot's pending recording arm. |
| `cue(id, { quantize = 'bar', gain = 1 })` | Cue a completed sample on the selected crossing. Replace only that slot's pending cue. |
| `stopSample(id, { quantize = 'bar' })` | Cue a stop for this sample on the selected crossing. Replace only that slot's pending playback cue. |
| `cancelCue(id)` | Cancel that slot's pending sample cue. |
| `define(pattern)` | Validate and store a pattern whose samples already exist. |
| `queue(id, { quantize = 'bar' })` | Replace the pending pattern launch. |
| `cancelQueue()` | Clear the pending pattern launch and keep the current pattern. |
| `markOne()` | Set the next crossing as bar 1, beat 1 without changing tempo or phase. |
| `stopAll()` | Atomically cancel pending actions, commit active recordings, and clear patterns and voices. |
| `snapshot()` | Return the latest sequencer state. |
| `subscribe(listener)` | Supply state updates and return an unsubscribe function. |
| `dispose()` | Detach this wrapper from its endpoint. |

Quantization is `beat` or `bar`. Queue targets use beat serials rather than future milliseconds. A marked beat reanchors pending bar targets. Recording actions execute before sample cues and pattern hits at the same crossing, so a quantized stop can save a take before playback begins at that crossing. An already playing pattern keeps its relative position when the bar origin changes. A clock reset or epoch change commits active takes and clears pending actions and playback.

The sequencer snapshot contains `status`, `playing`, `queued`, `recordArms`, `cues`, `bar`, `beat`, `beatsPerBar`, `patterns`, and `metadata`. `playing` and `queued` can coexist. Each recording arm contains `sampleId`, `action`, `quantize`, and `targetBeatId`. Each playback cue contains `sampleId`, `action`, `quantize`, and `targetBeatId`. Its `action` is `play` or `stop`. The first actual crossing establishes the initial beat 1.

## State and cleanup

`AudioEndpoint` owns request IDs, acknowledgements, and state subscriptions for its MessagePort. `snapshot()` returns the latest `{ sampler, sequencer }` state. `subscribe(listener)` returns a detach function. The default 50 ms state poll supplies display metadata. Audio execution does not depend on polling. Pass `{ pollInterval: 0 }` as the second constructor argument to disable it.

Attached wrappers do not own the endpoint or context. Detach subscriptions, dispose both wrappers, dispose the endpoint, and dispose the tracker when releasing the shared runtime. A standalone sampler disposes its node and endpoint. It closes its AudioContext only if it created that context.

Run automated checks from the repository root.

```sh
node --test lib/sampler/tests/*.test.mjs
node --test lib/sequencer/tests/*.test.mjs
```

See [VERIFICATION.md](VERIFICATION.md) for the earlier engine verification record. Its removed demo-page instructions are historical. See [PLAN.md](PLAN.md) for the worklet protocol and engine contract.
