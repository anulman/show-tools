# Position-aware sequencer

Route a logical button to a different action in each song section. Programmed moments, mouse clicks, keyboard keys, and keyboard-emulating arcade buttons use the same routing.

The browser interface is the [practice desk](../../ui/practice/README.md). The former lighting-cue demo is removed. This directory contains the reusable routing and quantization engines.

## Program data

`program.buttons` defines logical controls and keyboard bindings. Each section maps button IDs to named actions. `program.moments` schedules activations of those same buttons.

```js
const program = {
	beatsPerBar: 4,
	buttons: [{ id: 'wash', label: 'Wash', key: 'KeyA' }],
	sections: [
		{ id: 'verse', label: 'Verse', atBeat: 0,
			actions: { wash: 'sageWash' } },
		{ id: 'chorus', label: 'Chorus', atBeat: 16,
			actions: { wash: 'goldWash' } },
	],
	moments: [{ id: 'opening', atBeat: 0, buttonId: 'wash' }],
};
```

Positions use zero-based whole-beat offsets. Displayed bars and beats start at one.

```js
atBeat = (bar - 1) * beatsPerBar + (beat - 1);
bar = Math.floor(atBeat / beatsPerBar) + 1;
beat = atBeat % beatsPerBar + 1;
```

In four beats per bar, `atBeat: 16` is bar 5, beat 1. Sections start at beat zero and have strictly increasing positions. Button, section, and moment IDs must each be unique within their list. A section can omit a button to leave that cue inactive.

A program is copied at construction. Create a new `Sequencer` after changing its configuration. The caller supplies an action registry through its dispatch callback.

## Use the API

Import the library into a browser build. Create the tracker from a user gesture so the browser can enable audio. These source imports assume a module at the repository root.

```js
import { Sequencer, beatTrackerClock, bindKeyboard } from './lib/sequencer/index.js';
import { BeatTracker } from './ui/practice/runtime/beat-tracker.ts';

const tracker = await BeatTracker.create({
	startingBpm: 120,
	wasmUrl: '/ui/practice/wasm/manual-clock.wasm',
	workletUrl: '/ui/practice/practice-worklet.js',
});
await tracker.setManual();
const sequence = new Sequencer({
	clock: beatTrackerClock(tracker),
	program,
	dispatch: event => actions[event.action](event),
});
const unsubscribe = sequence.subscribe(view => render(view));
const detachKeyboard = bindKeyboard(sequence, window);

sequence.play();
sequence.trigger('wash');
```

`play()` waits for a fresh crossing to start or resume. `pause()` holds the current position. `reset()` starts a new run at beat zero in the idle state. `trigger(buttonId)` resolves and dispatches the button at the committed position, including while idle or paused. `setAutomatic(boolean)` controls programmed moments.

`snapshot()` returns `state`, `positionBeat`, `bar`, `beat`, `section`, `automatic`, `buttons`, `lastAction`, `error`, and `metadata`. Render controls from `buttons` to keep their current actions and bindings aligned. `subscribe(listener)` immediately supplies a snapshot and returns an unsubscribe function.

The dispatch callback is synchronous. An asynchronous output must handle its own completion and errors.

An activation event contains `id`, `action`, `buttonId`, `source`, `positionBeat`, `bar`, `beat`, `sectionId`, `intendedTime`, `deliveredTime`, and `signal`. `id` identifies the occurrence. `source` is `manual` or `program`. Times use the source clock's seconds. The abort signal is canceled by transport changes, so callbacks can cancel pending work. An action already executed cannot be undone. A thrown callback error pauses transport and appears in `snapshot().error`.

`bindKeyboard(sequence, target)` ignores repeats, held-key duplicates, modifier chords, and editable fields. Bindings use `KeyboardEvent.code`. The returned function removes the binding. Call `detachKeyboard()`, `unsubscribe()`, `sequence.dispose()`, and `tracker.dispose()` when the application releases the sequence.

## Timing and diagnostics

The tracker supplies authoritative beat crossings. The sequencer has its own song origin because tracker beat IDs persist across resets. **Play** defines the next song beat. Microphone analysis does not infer the music's true bar boundaries.

Programmed moments resolve at their intended song positions, even when a batch arrives after a section boundary. Manual cues resolve at the latest committed beat. Browser callbacks can arrive after a beat crossing. These callbacks are not sample-accurate audio scheduling.

A missing crossing, dropped telemetry, a changed clock epoch, or unavailable audio suspends the sequence. Press **Play** to resume from a fresh crossing. Cancellation stops remaining callbacks in the current delivery batch. Automatic triggers skipped while disabled are consumed.

The clock interface is `now()` plus `subscribe(listener)`. Each observation contains `now`, `available`, `epoch`, `droppedEvents`, `beatId`, and `beats`, where each beat has an `id` and source time `at`. `subscribe` returns an unsubscribe function. See [PLAN.md](PLAN.md) for the full transport contract.

Run the library tests from the repository root.

```sh
node --test lib/sequencer/tests/*.test.mjs
```

See [VERIFICATION.md](VERIFICATION.md) for the earlier engine verification record. Its removed demo-page instructions are historical.

## Audio scheduling

`AudioSequenceEngine` runs inside the audio worklet and schedules samples and recording boundaries at authoritative beat frames. `AudioSequencer` exposes acknowledged commands through a shared `AudioEndpoint`. Patterns are finite and use whole-beat offsets.

The practice desk's worklet owns its repeating groove and song transport. It does not requeue patterns from browser telemetry. Quantized recording stops commit the take before starting its loop at that same crossing. The [sampler reference](../sampler/README.md#audio-sequencer-api) lists the audio scheduling methods.
