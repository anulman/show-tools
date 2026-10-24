# Position-aware sequencer

## Requested behavior

A song defines configurable actions by musical position. Programmed moments, mouse buttons, keyboard keys, and future keyboard-emulating arcade buttons activate the same logical buttons. One resolver chooses the action from the section at that activation's beat. Program timing uses bars and beats, represented internally by zero-based whole-beat offsets. The first version supports a configurable positive integer beatsPerBar, default four.

## Usage and data

```js
const program = {
  beatsPerBar: 4,
  buttons: [{ id: 'hit', label: 'Hit', key: 'KeyA' }],
  sections: [
    { id: 'verse', label: 'Verse', atBeat: 0, actions: { hit: 'blue' } },
    { id: 'chorus', label: 'Chorus', atBeat: 16, actions: { hit: 'gold' } },
  ],
  moments: [{ id: 'opening', atBeat: 0, buttonId: 'hit' }],
};
const sequence = new Sequencer({ clock: beatTrackerClock(tracker), program,
  dispatch: event => actions[event.action](event) });
sequence.subscribe(view => render(view));
sequence.play();
sequence.trigger('hit');
```

The public API is Sequencer, beatTrackerClock, and bindKeyboard. Sequencer exposes play(), pause(), reset(), trigger(buttonId), setAutomatic(boolean), snapshot(), subscribe(listener), and dispose(). bindKeyboard(sequence, target) returns a detach function. A program is validated and copied once. Buttons, bindings, and program moments share IDs rather than mirrored UI lists.

## Clock and transport contract

A clock has now() returning monotonic source seconds and subscribe(listener) returning an unsubscribe function. Its observations contain {now, available, epoch, droppedEvents, beatId, beats:[{id, at}]}. at is source seconds. The tracker adapter maps engine crossing frames to AudioContext time and never commits snapshot forecasts as beats. The existing tracker retains lifetime beat IDs through Reset, so sequencer position has its own origin.

Play arms until the first actual crossing after clock.now(), which establishes sequence beat zero. Resume after Pause waits for a fresh crossing and advances to the next unconsumed sequence beat. Pause freezes position and cancels the current delivery generation. Reset creates a new run at position zero and idle. Delayed crossings at or before the Play/Resume source timestamp cannot advance the run. Duplicate batches cannot repeat actions. A missing crossing, dropped telemetry, epoch change, or unavailable source suspends the sequence and requires explicit Play to reanchor. Microphone stop alone does not stop the clock or sequence.

Scheduled moments resolve their own intended beat, including delayed batches spanning sections. Manual input resolves the latest committed sequence beat immediately. The same action may fire once from each source at the same beat. Disabling automatic triggers consumes their moments as the song advances, so enabling causes no catch-up. Section changes apply before moments at that beat. Stable program order resolves simultaneous moments.

Dispatch commits an activation before calling user code. If an action pauses, resets, or disposes the sequence, remaining deliveries in that batch stop. Action exceptions become an operator error and pause automatic transport. Each event includes action, buttonId, source, positionBeat, bar, beat, sectionId, occurrence ID, intendedTime, deliveredTime, and an AbortSignal. Cancellation cannot undo an action already executed.

snapshot() returns state, positionBeat, bar, beat, section, automatic, buttons, lastAction, error, and nested metadata. Diagnostics remain in metadata. subscribe() immediately emits the current snapshot. trigger() also works in idle or paused state at the held song position. Bindings ignore key repeat, modifier chords, editable fields, and held-key duplicates, and release latches on keyup or blur.

## Files and ownership

- index.js exports the public API.
- sequencer.js owns program validation, transport, routing, and dispatch.
- beat-tracker-clock.js adapts the existing tracker without changing its timing engine.
- browser-input.js normalizes keyboard controls. Mouse buttons call trigger().
- web contains the operator demo, sample song, and configurable visual callbacks.
- scripts/serve.py serves the lib directory on localhost:8081, keeping tracker assets available at their existing relative paths.
- tests cover observable action delivery, clock adaptation, and browser input.

## Design decision

Candidate B supplies one autonomous Sequencer owner and a small caller API. Candidate A contributes deterministic transitions and replayable clock observations inside that owner. The cross-review recommended this synthesis. Both original candidates bound actions directly to buttons; the clarified requirement replaces those bindings with section-dependent action maps. Seconds, recording, live program editing, and audio-thread action scheduling are outside the first version.

Model the Domain chooses one position-aware resolver and a transport state machine. Experience First keeps test controls and timing diagnostics off the operator page. Separate Before Serializing Shared State gives the engine and demo different file owners.

Browser callbacks follow authoritative beat telemetry and may arrive after a crossing. The first version does not claim sample-accurate action execution or infer the song's true bar boundaries from audio. Play establishes the song origin.

## Throughput checkpoint

- Blocking first steps. Existing timing ownership and output/timing product choices are resolved.
- Independent workstreams. The engine and tests have one owner; the demo and server have another after this contract.
- Shared mutable state. The Sequencer alone owns transport and dispatch. Each worker owns disjoint files.
- Smallest safe decomposition. Two implementations can proceed independently against this API; the coordinator integrates and verifies both.

## Verification

Exercise position-dependent manual and automatic actions, section boundaries, batched and duplicate observations, pause/resume, reset and callback cancellation, automatic off/on without replay, gaps, keyboard repeat, editable fields, and disposal. Drive the real demo with the existing WASM clock and inspect operator states. Existing beat tracker tests must remain green.
