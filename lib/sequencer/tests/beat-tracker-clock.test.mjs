import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatTracker } from '../../../ui/practice/runtime/beat-tracker.js';
import { Sequencer, beatTrackerClock } from '../index.js';

function message({ frame = 48000, contextFrame = 144000, beatId = 1, epoch = 1,
  droppedEvents = 0, events = [] } = {}) {
  return {
    snapshot: [frame, epoch, 0, 1, 1, 1, 120, 0, frame + 24000, beatId,
      120, 1, 120, 0, 0, 0, 0, droppedEvents, 0, 0, 48000, 0],
    contextFrame, events: events.flat(), memoryBytes: 0,
  };
}

function event(type, id, frame, epoch = 1) {
  return [type, id, frame, frame + 128, epoch, 0, 120, 1, 0, 0, 0, 0];
}

test('adapter maps actual engine crossings to AudioContext time and ignores forecasts and detections', () => {
  const tracker = new BeatTracker({ currentTime: 4, sampleRate: 48000 }, false);
  tracker.lifecycle = 'running';
  const clock = beatTrackerClock(tracker);
  const updates = [];
  const detach = clock.subscribe(update => updates.push(update));
  assert.equal(updates[0].available, false);
  tracker.accept(message({ events: [event(1, 1, 24000), event(2, 10, 30000), event(1, 2, 48000)] , beatId: 2 }));
  assert.deepEqual(updates.at(-1), {
    now: 4, available: true, epoch: 1, droppedEvents: 0, beatId: 2,
    beats: [{ id: 1, at: 2.5 }, { id: 2, at: 3 }],
  });
  tracker.context.currentTime = 4.2;
  assert.equal(clock.now(), 4.2);
  tracker.publish();
  assert.deepEqual(updates.at(-1).beats, []);
  tracker.source = { kind: 'off' };
  tracker.publish();
  assert.equal(updates.at(-1).available, true);
  tracker.lifecycle = 'suspended';
  tracker.publish();
  assert.equal(updates.at(-1).available, false);
  detach();
  assert.equal(tracker.listeners.size, 0);
});

test('real tracker batches preserve sequencer origin, faults, and lifetime crossing IDs', () => {
  const tracker = new BeatTracker({ currentTime: 3, sampleRate: 48000 }, false);
  tracker.lifecycle = 'running';
  tracker.accept(message({ beatId: 2 }));
  const events = [];
  const sequence = new Sequencer({ clock: beatTrackerClock(tracker), dispatch: event => events.push(event), program: {
    buttons: [{ id: 'hit', label: 'Hit' }],
    sections: [{ id: 'all', label: 'All', atBeat: 0, actions: { hit: 'blue' } }],
    moments: [{ id: 'start', atBeat: 0, buttonId: 'hit' }],
  } });
  sequence.play();
  tracker.context.currentTime = 4;
  tracker.accept(message({ frame: 96000, contextFrame: 192000, beatId: 4,
    events: [event(1, 3, 48000), event(1, 4, 96000)] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].intendedTime, 4);
  assert.equal(sequence.snapshot().positionBeat, 0);
  tracker.accept(message({ frame: 96000, contextFrame: 192000, beatId: 4, epoch: 2 }));
  assert.equal(sequence.snapshot().state, 'unavailable');
  sequence.reset();
  sequence.play();
  tracker.context.currentTime = 4.5;
  tracker.accept(message({ frame: 120000, contextFrame: 216000, beatId: 5, epoch: 2,
    events: [event(1, 5, 120000, 2)] }));
  assert.equal(events.length, 2);
  assert.equal(events[1].positionBeat, 0);
  sequence.dispose();
});
