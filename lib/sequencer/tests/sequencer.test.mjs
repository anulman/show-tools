import test from 'node:test';
import assert from 'node:assert/strict';
import { Sequencer } from '../index.js';

function song() {
  return {
    buttons: [{ id: 'hit', label: 'Hit', key: 'KeyA' }, { id: 'wash', label: 'Wash', key: 'KeyS' }],
    sections: [
      { id: 'verse', label: 'Verse', atBeat: 0, actions: { hit: 'blue' } },
      { id: 'chorus', label: 'Chorus', atBeat: 2, actions: { hit: 'gold', wash: 'white' } },
    ],
    moments: [
      { id: 'opening', atBeat: 0, buttonId: 'hit' },
      { id: 'second', atBeat: 2, buttonId: 'hit' },
      { id: 'simultaneous', atBeat: 2, buttonId: 'wash' },
      { id: 'later', atBeat: 4, buttonId: 'hit' },
    ],
  };
}

class Clock {
  time = 0;
  state = { now: 0, available: true, epoch: 1, droppedEvents: 0, beatId: 0, beats: [] };
  listeners = new Set();
  now = () => this.time;
  subscribe = listener => {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  };
  emit(beats = [], changes = {}) {
    this.time = Math.max(this.time, ...beats.map(beat => beat.at));
    this.state = { ...this.state, now: this.time, beats,
      beatId: beats.at(-1)?.id ?? this.state.beatId, ...changes };
    for (const listener of [...this.listeners]) listener(this.state);
  }
  beat(id, at = id) { this.emit([{ id, at }]); }
}

function fixture(options = {}) {
  const clock = new Clock();
  const events = [];
  const sequence = new Sequencer({ clock, program: options.program || song(),
    dispatch: event => { events.push(event); options.dispatch?.(event, sequence); } });
  return { clock, sequence, events };
}

test('manual and programmed moments share the position resolver, with stable simultaneous order', () => {
  const { clock, sequence, events } = fixture();
  assert.equal(sequence.trigger('wash'), null);
  assert.equal(sequence.trigger('hit').action, 'blue');
  sequence.play();
  assert.equal(sequence.snapshot().state, 'armed');
  clock.time = 10;
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.deepEqual(events.map(event => [event.source, event.action, event.positionBeat]), [
    ['manual', 'blue', 0], ['program', 'blue', 0], ['program', 'gold', 2], ['program', 'white', 2],
  ]);
  assert.equal(events[2].intendedTime, 3);
  assert.equal(events[2].deliveredTime, 10);
  assert.equal(events[2].sectionId, 'chorus');
  assert.equal(events[2].id, '1:program:second');
  assert.equal(events[2].signal.aborted, false);
  assert.equal(sequence.trigger('hit').action, 'gold');
  const view = sequence.snapshot();
  assert.equal(view.positionBeat, 2);
  assert.equal(view.bar, 1);
  assert.equal(view.beat, 3);
  assert.deepEqual(view.section, { id: 'chorus', label: 'Chorus' });
  assert.equal(view.buttons[1].action, 'white');
  assert.equal(view.lastAction, events.at(-1));
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.equal(events.length, 5);
  sequence.dispose();
});

test('play and resume exclude delayed pre-command crossings and resume at the next song beat', () => {
  const { clock, sequence, events } = fixture();
  clock.time = 5;
  sequence.play();
  clock.emit([{ id: 1, at: 4 }, { id: 2, at: 5 }]);
  assert.equal(sequence.snapshot().state, 'armed');
  assert.equal(events.length, 0);
  clock.beat(3, 6);
  assert.equal(sequence.snapshot().positionBeat, 0);
  sequence.pause();
  assert.equal(events[0].signal.aborted, true);
  clock.time = 10;
  sequence.play();
  clock.emit([{ id: 4, at: 7 }, { id: 5, at: 10 }, { id: 6, at: 11 }]);
  assert.equal(sequence.snapshot().positionBeat, 1);
  clock.beat(7, 12);
  assert.equal(sequence.snapshot().positionBeat, 2);
  assert.deepEqual(events.map(event => event.action), ['blue', 'gold', 'white']);
  sequence.dispose();
});

test('automatic off consumes moments and does not affect manual input', () => {
  const { clock, sequence, events } = fixture();
  sequence.setAutomatic(false);
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.equal(events.length, 0);
  assert.equal(sequence.trigger('hit').action, 'gold');
  sequence.setAutomatic(true);
  clock.beat(4);
  assert.equal(events.length, 1);
  clock.beat(5);
  assert.equal(events[1].id, '1:program:later');
  sequence.dispose();
});

test('backward clock snapshots suspend without rolling back the accepted source baseline', () => {
  const { clock, sequence, events } = fixture();
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.equal(events.length, 3);
  clock.emit([{ id: 2, at: 2 }]);
  assert.equal(sequence.snapshot().state, 'unavailable');
  assert.equal(sequence.snapshot().metadata.clock.beatId, 3);
  clock.emit([{ id: 3, at: 3 }]);
  assert.equal(events.length, 3);
  sequence.play();
  clock.beat(4);
  assert.equal(sequence.snapshot().positionBeat, 3);
  clock.beat(5);
  assert.equal(events.length, 4);
  assert.equal(events[3].id, '1:program:later');
  sequence.dispose();
});

test('duplicate crossings within one batch are delivered once', () => {
  const { clock, sequence, events } = fixture();
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.equal(sequence.snapshot().state, 'running');
  assert.equal(sequence.snapshot().positionBeat, 2);
  assert.deepEqual(events.map(event => event.id), [
    '1:program:opening', '1:program:second', '1:program:simultaneous',
  ]);
  sequence.dispose();
});

for (const command of ['pause', 'reset', 'dispose']) {
  test(`dispatch ${command} cancels the remainder of a batch after committing the current beat`, () => {
    const { clock, sequence, events } = fixture({ dispatch: (_event, owner) => owner[command]() });
    sequence.play();
    clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].signal.aborted, true);
    assert.equal(sequence.snapshot().state, { pause: 'paused', reset: 'idle', dispose: 'disposed' }[command]);
    assert.equal(sequence.snapshot().positionBeat, 0);
    if (command !== 'dispose') {
      sequence.play();
      clock.beat(4);
      assert.equal(sequence.snapshot().positionBeat, command === 'pause' ? 1 : 0);
    }
    sequence.dispose();
  });
}

test('pause during a simultaneous moment does not replay the undelivered moment on resume', () => {
  const { clock, sequence, events } = fixture({ dispatch: (event, owner) => {
    if (event.id.endsWith(':second')) owner.pause();
  } });
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }, { id: 4, at: 4 }]);
  assert.deepEqual(events.map(event => event.action), ['blue', 'gold']);
  assert.equal(sequence.snapshot().positionBeat, 2);
  sequence.play();
  clock.beat(5);
  assert.equal(sequence.snapshot().positionBeat, 3);
  assert.equal(events.length, 2);
  sequence.dispose();
});

for (const [name, changes, beats] of [
  ['unavailable', { available: false }, []],
  ['epoch change', { epoch: 2 }, []],
  ['dropped telemetry', { droppedEvents: 1 }, []],
  ['missing event', { beatId: 2 }, []],
  ['gap inside a batch', {}, [{ id: 3, at: 3 }]],
]) {
  test(`${name} suspends transport until an explicit reanchor`, () => {
    const { clock, sequence, events } = fixture();
    sequence.play();
    clock.beat(1);
    clock.emit(beats, changes);
    assert.equal(sequence.snapshot().state, 'unavailable');
    assert.ok(sequence.snapshot().error);
    assert.equal(events[0].signal.aborted, true);
    clock.emit([], { available: true });
    const nextId = clock.state.beatId + 1;
    clock.beat(nextId, 10);
    assert.equal(sequence.snapshot().state, 'unavailable');
    sequence.play();
    clock.beat(nextId + 1, 11);
    assert.equal(sequence.snapshot().state, 'running');
    assert.equal(sequence.snapshot().positionBeat, 1);
    assert.equal(sequence.snapshot().error, null);
    sequence.dispose();
  });
}

test('reset uses its own song origin despite lifetime source IDs and produces new occurrence IDs', () => {
  const { clock, sequence, events } = fixture();
  sequence.play();
  clock.beat(1);
  sequence.reset();
  assert.equal(sequence.snapshot().lastAction, null);
  assert.equal(sequence.snapshot().state, 'idle');
  sequence.play();
  clock.beat(2);
  assert.deepEqual(events.map(event => [event.id, event.positionBeat]), [
    ['1:program:opening', 0], ['2:program:opening', 0],
  ]);
  sequence.dispose();
});

test('action exceptions are readable operator errors and stop remaining deliveries', () => {
  const { clock, sequence, events } = fixture({ dispatch: () => { throw new Error('lamp disconnected'); } });
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }]);
  assert.equal(sequence.snapshot().state, 'paused');
  assert.match(sequence.snapshot().error, /blue.*lamp disconnected/);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal.aborted, true);
  sequence.dispose();
});

for (const command of ['pause', 'reset', 'play', 'suspend', 'gap', 'exception', 'dispose']) {
  test(`abort listeners can dispose during ${command} without resurrecting transport`, () => {
    const { clock, sequence, events } = fixture({ dispatch: (event, owner) => {
      event.signal.addEventListener('abort', () => owner.dispose(), { once: true });
      if (command === 'exception') throw new Error('dispatch failed');
    } });
    if (command === 'suspend' || command === 'gap') sequence.play();
    sequence.trigger('hit');
    if (command === 'suspend') clock.emit([], { available: false });
    else if (command === 'gap') clock.emit([{ id: 2, at: 2 }], { beatId: 3 });
    else if (command !== 'exception') sequence[command]();
    assert.equal(sequence.snapshot().state, 'disposed');
    assert.equal(clock.listeners.size, 0);
    assert.equal(sequence.trigger('hit'), null);
    clock.beat(1);
    assert.equal(events.length, 1);
  });
}

test('a cancellation callback sees the committed transition and the replacement signal', () => {
  const { sequence, events } = fixture();
  const first = sequence.trigger('hit');
  first.signal.addEventListener('abort', () => {
    assert.equal(sequence.snapshot().state, 'paused');
    sequence.trigger('hit');
  }, { once: true });
  sequence.pause();
  assert.equal(events.length, 2);
  assert.equal(events[0].signal.aborted, true);
  assert.equal(events[1].signal.aborted, false);
  sequence.dispose();
});

test('program is copied, snapshots are isolated, subscriptions are immediate, and disposal detaches', () => {
  const program = song();
  program.beatsPerBar = 3;
  const { clock, sequence } = fixture({ program });
  program.sections[0].actions.hit = 'mutated';
  const views = [];
  const detach = sequence.subscribe(view => views.push(view));
  assert.equal(views.length, 1);
  views[0].buttons[0].action = 'changed';
  assert.equal(sequence.trigger('hit').action, 'blue');
  sequence.play();
  clock.emit([{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }, { id: 4, at: 4 }]);
  assert.equal(sequence.snapshot().bar, 2);
  assert.equal(sequence.snapshot().beat, 1);
  detach();
  const count = views.length;
  sequence.pause();
  assert.equal(views.length, count);
  sequence.dispose();
  assert.equal(clock.listeners.size, 0);
  assert.equal(sequence.trigger('hit'), null);
  sequence.play();
  sequence.reset();
  assert.equal(sequence.snapshot().state, 'disposed');
});

test('invalid programs fail before the clock is subscribed', () => {
  for (const mutate of [
    program => { program.beatsPerBar = 0; },
    program => { program.buttons.push({ ...program.buttons[0] }); },
    program => { program.buttons[1].key = 'KeyA'; },
    program => { program.sections[0].atBeat = 1; },
    program => { program.sections[1].atBeat = 0; },
    program => { program.sections[0].actions.unknown = 'red'; },
    program => { program.sections[0].actions.hit = null; },
    program => { program.moments[0].atBeat = 0.5; },
    program => { program.moments[0].atBeat = Infinity; },
    program => { program.moments[0].buttonId = 'unknown'; },
    program => { program.moments.push({ ...program.moments[0] }); },
  ]) {
    const clock = new Clock();
    const program = song();
    mutate(program);
    assert.throws(() => new Sequencer({ clock, program, dispatch() {} }), TypeError);
    assert.equal(clock.listeners.size, 0);
  }
});
