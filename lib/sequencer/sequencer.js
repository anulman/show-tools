function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

function wholeBeat(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative whole beat`);
  return value;
}

function copyProgram(input) {
  record(input, 'Program');
  const beatsPerBar = input.beatsPerBar === undefined ? 4 : input.beatsPerBar;
  if (!Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new TypeError('beatsPerBar must be a positive integer');
  }
  const lists = {};
  for (const name of ['buttons', 'sections', 'moments']) {
    if (!Array.isArray(input[name])) throw new TypeError(`${name} must be an array`);
    const ids = new Set();
    lists[name] = input[name].map(item => {
      record(item, name);
      const id = text(item.id, `${name} id`);
      if (ids.has(id)) throw new TypeError(`Duplicate ${name} id ${id}`);
      ids.add(id);
      return item;
    });
  }
  const keys = new Set();
  const buttons = lists.buttons.map(button => {
    const key = button.key === undefined ? null : text(button.key, 'Button key');
    if (key !== null && keys.has(key)) throw new TypeError(`Duplicate keyboard key ${key}`);
    keys.add(key);
    return { id: button.id, label: text(button.label, 'Button label'), key };
  });
  const buttonIds = new Set(buttons.map(button => button.id));
  const sections = lists.sections.map((section, index) => {
    const atBeat = wholeBeat(section.atBeat, 'Section position');
    if ((index === 0 && atBeat !== 0) || (index > 0 && atBeat <= lists.sections[index - 1].atBeat)) {
      throw new TypeError('Sections must start at beat zero and have strictly increasing positions');
    }
    record(section.actions, 'Section actions');
    const actions = Object.create(null);
    for (const [buttonId, action] of Object.entries(section.actions)) {
      if (!buttonIds.has(buttonId)) throw new TypeError(`Unknown button ${buttonId} in section ${section.id}`);
      actions[buttonId] = text(action, 'Action');
    }
    return { id: section.id, label: text(section.label, 'Section label'), atBeat, actions };
  });
  if (!sections.length) throw new TypeError('At least one section at beat zero is required');
  const moments = lists.moments.map(moment => {
    if (!buttonIds.has(moment.buttonId)) throw new TypeError(`Unknown button ${moment.buttonId} in moment ${moment.id}`);
    return { id: moment.id, buttonId: moment.buttonId, atBeat: wholeBeat(moment.atBeat, 'Moment position') };
  }).sort((left, right) => left.atBeat - right.atBeat);
  const momentsByBeat = new Map();
  for (const moment of moments) {
    if (!momentsByBeat.has(moment.atBeat)) momentsByBeat.set(moment.atBeat, []);
    momentsByBeat.get(moment.atBeat).push(moment);
  }
  return { beatsPerBar, buttons, sections, momentsByBeat };
}

export class Sequencer {
  constructor({ clock, program, dispatch }) {
    if (!clock || typeof clock.now !== 'function' || typeof clock.subscribe !== 'function') {
      throw new TypeError('A clock with now() and subscribe() is required');
    }
    if (typeof dispatch !== 'function') throw new TypeError('dispatch must be a function');
    this.program = copyProgram(program);
    this.clock = clock;
    this.dispatch = dispatch;
    this.state = 'idle';
    this.positionBeat = 0;
    this.nextPosition = 0;
    this.automatic = true;
    this.lastAction = null;
    this.error = null;
    this.listeners = new Set();
    this.runId = 1;
    this.generation = 0;
    this.manualId = 0;
    this.controller = new AbortController();
    this.observation = null;
    this.lastBeatId = null;
    this.lastBeatTime = null;
    this.armTime = null;
    this.unsubscribeClock = clock.subscribe(observation => this.observe(observation));
  }

  sectionAt(position) {
    let section = this.program.sections[0];
    for (const candidate of this.program.sections) {
      if (candidate.atBeat > position) break;
      section = candidate;
    }
    return section;
  }

  snapshot() {
    const section = this.sectionAt(this.positionBeat);
    return {
      state: this.state,
      positionBeat: this.positionBeat,
      bar: Math.floor(this.positionBeat / this.program.beatsPerBar) + 1,
      beat: this.positionBeat % this.program.beatsPerBar + 1,
      section: { id: section.id, label: section.label },
      automatic: this.automatic,
      buttons: this.program.buttons.map(button => ({ ...button, action: section.actions[button.id] ?? null })),
      lastAction: this.lastAction,
      error: this.error,
      metadata: {
        beatsPerBar: this.program.beatsPerBar, runId: this.runId, generation: this.generation,
        clock: this.observation ? { ...this.observation } : null,
        lastBeatId: this.lastBeatId,
      },
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A listener is required');
    if (this.state !== 'disposed') this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  publish() {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  cancelGeneration() {
    const previous = this.controller;
    this.controller = new AbortController();
    this.generation++;
    previous.abort();
  }

  play() {
    if (this.state === 'disposed' || this.state === 'running' || this.state === 'armed') return;
    if (!this.observation?.available) {
      this.state = 'unavailable';
      this.error = 'Beat clock is unavailable. Resume audio, then press Play.';
    } else {
      this.armTime = this.clock.now();
      this.lastBeatId = null;
      this.lastBeatTime = null;
      this.state = 'armed';
      this.error = null;
    }
    this.cancelGeneration();
    this.publish();
  }

  pause() {
    if (this.state === 'disposed') return;
    this.state = 'paused';
    this.cancelGeneration();
    this.publish();
  }

  reset() {
    if (this.state === 'disposed') return;
    this.runId++;
    this.positionBeat = 0;
    this.nextPosition = 0;
    this.lastBeatId = null;
    this.lastBeatTime = null;
    this.lastAction = null;
    this.error = null;
    this.state = 'idle';
    this.cancelGeneration();
    this.publish();
  }

  setAutomatic(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Automatic must be a boolean');
    if (this.state === 'disposed') return;
    this.automatic = enabled;
    this.publish();
  }

  trigger(buttonId) {
    if (this.state === 'disposed') return null;
    if (!this.program.buttons.some(button => button.id === buttonId)) throw new TypeError(`Unknown button ${buttonId}`);
    const now = this.clock.now();
    return this.activate(buttonId, 'manual', `manual:${++this.manualId}`, this.positionBeat, now);
  }

  activate(buttonId, source, occurrence, positionBeat, intendedTime) {
    const section = this.sectionAt(positionBeat);
    const action = section.actions[buttonId];
    if (action === undefined) return null;
    const event = Object.freeze({
      id: `${this.runId}:${occurrence}`, action, buttonId, source, positionBeat,
      bar: Math.floor(positionBeat / this.program.beatsPerBar) + 1,
      beat: positionBeat % this.program.beatsPerBar + 1,
      sectionId: section.id, intendedTime, deliveredTime: this.clock.now(),
      signal: this.controller.signal,
    });
    this.lastAction = event;
    try {
      this.dispatch(event);
    } catch (error) {
      if (this.state !== 'disposed') {
        this.state = 'paused';
        this.error = `Action ${action} failed. ${error instanceof Error ? error.message : String(error)}`;
        this.cancelGeneration();
      }
    }
    this.publish();
    return event;
  }

  suspend(message) {
    this.state = 'unavailable';
    this.error = `${message} Press Play to reanchor.`;
    this.cancelGeneration();
  }

  observe(update) {
    if (this.state === 'disposed') return;
    const previous = this.observation;
    const { now, available, epoch, droppedEvents, beatId } = update;
    if (previous && epoch === previous.epoch && beatId < previous.beatId) {
      if (this.state === 'running' || this.state === 'armed') {
        this.suspend('Beat clock moved backward.');
        this.publish();
      }
      return;
    }
    this.observation = { now, available, epoch, droppedEvents, beatId };
    if (this.state !== 'running' && this.state !== 'armed') {
      this.publish();
      return;
    }
    if (!available) this.suspend('Beat clock is unavailable.');
    else if (previous && epoch !== previous.epoch) this.suspend('Beat clock timeline changed.');
    else if (previous && droppedEvents !== previous.droppedEvents) this.suspend('Beat clock dropped events.');
    else {
      const generation = this.generation;
      const seen = new Set();
      const beats = update.beats.filter(beat => {
        if ((previous && beat.id <= previous.beatId) || seen.has(beat.id)) return false;
        seen.add(beat.id);
        return true;
      });
      let expectedId = previous?.beatId;
      for (const beat of beats) {
        if (expectedId !== undefined && beat.id !== expectedId + 1) {
          this.suspend('A beat crossing is missing.');
          break;
        }
        expectedId = beat.id;
      }
      if (generation === this.generation && expectedId !== undefined && beatId > expectedId) {
        this.suspend('A beat crossing is missing.');
      }
      for (const beat of beats) {
        if (this.state === 'unavailable' || generation !== this.generation) break;
        if (this.state === 'armed' && beat.at <= this.armTime) continue;
        if (this.lastBeatTime !== null && beat.at <= this.lastBeatTime) {
          this.suspend('Beat clock timestamps are out of order.');
          break;
        }
        this.state = 'running';
        this.positionBeat = this.nextPosition++;
        this.lastBeatId = beat.id;
        this.lastBeatTime = beat.at;
        if (this.automatic) {
          for (const moment of this.program.momentsByBeat.get(this.positionBeat) || []) {
            if (generation !== this.generation || this.state !== 'running') break;
            if (!this.automatic) break;
            this.activate(moment.buttonId, 'program', `program:${moment.id}`, this.positionBeat, beat.at);
          }
        }
      }
    }
    this.publish();
  }

  dispose() {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.cancelGeneration();
    this.unsubscribeClock?.();
    this.publish();
    this.listeners.clear();
  }
}
