import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compiledCaptureFixture as fixture } from './fixtures/compiled-capture.js';
import { encodeCompiledProgram, compiledProgramBytes } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[], rate = 8000, initialVoiceEffects?: Parameters<NativePerformance['prepareVoiceEffects']>[0]) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0, initialVoiceEffects });
}
function render(native: NativePerformance, frames: number, value: number | ((frame: number) => number) = .25) {
  const begin = native.processedFrames;
  const input = Float32Array.from({ length: frames }, (_, index) => typeof value === 'number' ? value : value(begin + index));
  const mixed = [new Float32Array(frames), new Float32Array(frames)];
  const live = [new Float32Array(frames), new Float32Array(frames)];
  native.process(input, mixed, frames, live);
  return { mixed, live, events: native.events() };
}
function until(native: NativePerformance, bar: number, beat = 1, input = .25, chunk = 64) {
  for (let attempts = 0; attempts * chunk < 640000; attempts++) {
    const state = native.state();
    if (state.bar === bar && state.beat === beat && state.phase === 'playing') return;
    render(native, chunk, input);
  }
  throw new Error(`Did not reach ${bar}:${beat}`);
}

test('compiled artifact drives effected WASM capture, crb handoff, layer autoplay, fractional stop, and both download stems', async () => {
  const song = await fixture();
  assert(song.executable);
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    assert.equal(native.liveEffects().captureSupported, true);
    native.setMicrophone(true);
    native.start({ runId: 'joint-fixture', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' }, 'arm');
    assert.equal(native.compiledTake(0).frames, 0, 'arming switches the route without capturing early audio');
    until(native, 1);
    native.control({ id: 'R1' }, 'commit-arm');
    until(native, 2);
    assert.equal(native.compiledTake(0).frames, 16000);
    assert.equal(native.compiledTake(0).revision, 1);
    assert.equal(native.compiledTake(0).ready, true);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.status, 'recording');
    native.control({ id: 'R1' }, 'commit');
    until(native, 3);
    assert.equal(native.compiledTake(1).frames, 16000);
    const output = render(native, 128);
    const takeState = native.state().compiledTakes;
    assert(takeState);
    assert.equal(takeState.length, song.takes.length);
    assert.deepEqual(takeState.slice(0, 2).map(take => ({ index: take.index, ready: take.ready, playback: take.playback })),
      [{ index: 0, ready: true, playback: 'playing' }, { index: 1, ready: true, playback: 'playing' }]);
    assert(output.events.every(event => event.state.compiledTakes === undefined), 'historical events cannot inherit current take readback');
    assert(output.mixed[0].every(sample => Math.abs(sample - .625) < 1e-6), 'both processed takes autoplay as layers');
    assert(output.live[0].every(sample => Math.abs(sample - .25) < 1e-6), 'the restored default route warms from its own cold delay; capture history belongs to playback');
    assert.deepEqual(output.mixed[0], output.mixed[1]);
    assert.deepEqual(output.live[0], output.live[1]);
    assert(output.mixed[0].every((sample, index) => Math.abs(sample + output.live[0][index] - .875) < 1e-6), 'download mix contains each route once without a duplicated capture tail');
    const warm = render(native, 800);
    assert(warm.live[0].slice(-128).every(sample => Math.abs(sample - .3125) < 1e-6));
    until(native, 3, 4);
    native.control({ id: 'R1' }, 'fractional-stop');
    const pendingLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(pendingLight?.kind === 'releasing' && pendingLight.remainingMs > 0);
    const clock = native.query('pf_snapshot');
    const target = Math.ceil(clock[PF.CLOCK_BEAT_FRAME] + 1000);
    const remaining = target - native.processedFrames;
    const stopped = render(native, remaining + 1);
    assert(Math.abs(stopped.mixed[0][remaining - 1] - .625) < 1e-6);
    assert(Math.abs(stopped.mixed[0][remaining] - .125) < 1e-6);
    const tailLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(tailLight?.kind === 'releasing' && tailLight.remainingMs > 0, 'audible release retains native light feedback');
    const released = render(native, 800);
    assert.equal(released.mixed[0][799], 0);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.light.kind, 'off');
    assert(stopped.events.some(event => event.type === 'state' && event.frame === target), 'fractional action publishes its effective source frame');
    native.stop();
    const silent = render(native, 1000);
    assert([...silent.live, ...silent.mixed].every(channel => channel.every(sample => sample === 0)));
  } finally { native.dispose(); }
});

test('WASM loop history evolves from original source, never a second effects pass on printed PCM', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    native.setMicrophone(true);
    native.start({ runId: 'evolving', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1, 1, 0);
    const captureStart = native.processedFrames - native.compiledTake(0).frames;
    native.control({ id: 'R1' });
    const commitFrame = captureStart + 16000;
    const output = render(native, commitFrame - native.processedFrames + 32000 + 801, frame => frame === captureStart + 2000 || frame === commitFrame - 1 ? 1 : 0);
    const playbackStart = commitFrame - (native.processedFrames - output.mixed[0].length);
    assert.equal(output.mixed[0][playbackStart + 799], .25, 'first loop continues the actual capture-end history');
    assert.equal(output.live[0][playbackStart + 799], 0, 'the transferred capture history is not emitted again by the new live/capture epoch');
    assert.equal(output.mixed[0][playbackStart + 16000 + 799], .25, 'second loop retains the preceding iteration tail');
    assert.equal(output.mixed[0][playbackStart + 2800], .25);
    assert.equal(output.mixed[0][playbackStart + 3600], 0, 'printed wet PCM is not processed through the stack again');
    assert(output.mixed[0].every(Number.isFinite));
  } finally { native.dispose(); }
});

test('native byte artifact and failed replacement preserve an existing prepared program', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)), 48000);
  try {
    const bytes = compiledProgramBytes(song);
    const pointer = native.call('malloc', bytes.byteLength);
    try {
      new Uint8Array(native.memory.buffer, pointer, bytes.length).set(bytes);
      native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length);
      const state = native.state();
      const immediateLeadIn = Array.from(encodeCompiledProgram(song));
      immediateLeadIn[PF.COMPILED_HEADER_FIELDS + song.takes.length * PF.COMPILED_TAKE_FIELDS + 5] = 0;
      assert.throws(() => native.configureCompiled(immediateLeadIn), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      new Uint8Array(native.memory.buffer, pointer, 8).fill(0);
      assert.throws(() => native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .25 }]);
      assert.equal(native.liveEffects().captureSupported, true);
      assert.equal(native.memory.buffer.byteLength, 268435456);
    } finally { native.invoke('free', pointer); }
  } finally { native.dispose(); }
});

test('a tempo input before Start cannot replace the configured tempo with an unstarted clock value', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture())));
  try {
    assert.throws(() => native.control({ id: 'tempo' }), /active practice|tempo hit/i);
    assert.equal(native.state().bpm, 120);
    assert.equal(native.tempoHitInfo().count, 0);
  } finally { native.dispose(); }
});

test('stopped identical effect preparation refreshes reusable banks after a venue edit', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture())));
  const first = [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  const second = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function capture(run: number) {
    native.setMicrophone(true);
    native.start({ runId: `recapture-${run}`, bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1);
    native.control({ id: 'R1' });
    until(native, 2);
    native.control({ id: 'R1' });
    until(native, 3);
    native.stop();
  }
  try {
    native.prepareLiveEffects(first);
    capture(0);
    native.prepareLiveEffects(second);
    assert.equal(native.compiledTake(0).revision, 1, 'the completed old take retains its graph');
    for (let run = 1; run <= 3; run++) {
      native.prepareLiveEffects(second);
      capture(run);
      assert.equal(native.compiledTake(0).revision, 2);
      assert.equal(native.compiledTake(1).revision, 2);
    }
  } finally { native.dispose(); }
});

test('stale venue bank rejects recapture nonfatally during transport until stopped preparation', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture({ inTransportRecapture: true }))));
  const edited = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function startAndCapture(runId: string) {
    native.setMicrophone(true);
    native.start({ runId, bpm: 120, countInBars: 0, startBar: 1, endBar: 4, loop: true });
    until(native, 1, 1, .25, 1);
    native.control({ id: 'R1' });
    until(native, 2, 1, .25, 1);
    native.control({ id: 'R1' });
  }
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    startAndCapture('old-venue');
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('new-venue');
    until(native, 4, 4);
    until(native, 1);
    const before = native.compiledTake(0);
    const channels = native.state().channels;
    assert.throws(() => native.control({ id: 'R1' }), /No reusable take bank/);
    assert.deepEqual(native.compiledTake(0), before);
    assert.deepEqual(native.state().channels, channels);
    const output = render(native, 128);
    assert.equal(native.state().phase, 'playing');
    assert(output.mixed.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    assert(output.live.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('refreshed');
    assert.equal(native.compiledTake(0).revision, 2);
  } finally { native.dispose(); }
});

test('independent native voice graphs survive equal-revision compiled loads and preserve untouched revisions', async () => {
  const song = await fixture();
  const program = Array.from(encodeCompiledProgram(song));
  const native = engine(program);
  try {
    const venue = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [{ kind: 'slapback' as const, delayMs: 100, feedback: 0, wet: profile === 0 ? .5 : .25 }] }));
    const applied = native.prepareVoiceEffects(venue);
    assert(applied.every(profile => profile.revision === 1));
    for (let run = 0; run < 2; run++) {
      native.configureCompiled(program);
      native.setMicrophone(true);
      native.start({ runId: 'profile-load', bpm: 120, countInBars: 1, endBar: 4, loop: false });
      native.control({ id: 'R1' }); until(native, 1); native.control({ id: 'R1' }); until(native, 2);
      assert.equal(native.compiledTake(0).revision, 1);
      assert(render(native, 128).mixed[0].every(value => value === .375), 'pad capture and END playback use its actual .5 wet graph rather than equal-revision default .25');
      native.stop();
    }
    const before = native.voiceEffects();
    const retained = native.compiledTake(0);
    venue[0].effects[0].wet = .75;
    const updated = native.prepareVoiceEffects(venue);
    assert.equal(updated[0].revision, 2);
    assert.deepEqual(updated.slice(1), before.slice(1));
    assert.deepEqual(native.compiledTake(0), retained, 'retained take keeps its recorded stack revision');
    const invalid = venue.map(profile => ({ ...profile, effects: profile.effects.map(effect => ({ ...effect })) }));
    invalid[5].effects[0].delayMs = 999;
    assert.throws(() => native.prepareVoiceEffects(invalid), /Invalid slapback/);
    assert.deepEqual(native.voiceEffects(), updated);
  } finally { native.dispose(); }
});

test('real WASM backup graph follows relative rotation and native quarter-count grid release with ordered PCM and natural tails', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_ROTATION_MAGIC, 2, .25, 1, 0, 1, 1, 2, 0, 3, 2];
  const native = engine(program);
  try {
    const backupEffects = [
      { kind: 'slapback' as const, delayMs: 40, feedback: 0, wet: .5 },
      { kind: 'chorus' as const, rateHz: 1, depthMs: 0, baseDelayMs: 10, wet: .25 },
    ];
    native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: profile === PF.BACKUP_PROFILE ? backupEffects : [] })));
    const backup = () => {
      const profile = native.voiceEffects().find(voice => voice.profile === PF.BACKUP_PROFILE);
      if (!profile) throw new Error('Missing backup profile');
      return profile;
    };
    assert.deepEqual(backup().effects, backupEffects);
    native.setMicrophone(true); native.start({ runId: 'rotation-graph', bpm: 120, countInBars: 0, endBar: 4, loop: false }); until(native, 1, 1, 0);
    native.control({ id: 'knob', value: -2 }, 'rotation/1');
    assert.equal(backup().activity, 'live');
    const boundary = native.query('pf_snapshot')[PF.CLOCK_BEAT_FRAME] + 1000;
    assert(Math.abs(native.processedFrames + backup().rotationRemainingBeats * 4000 - boundary) < 1e-6);
    const first = render(native, 1, 1), response = render(native, 400, 0);
    assert.equal(first.live[0][0], 1);
    const expected = new Float32Array(400); expected[79] = .25; expected[319] = .5; expected[399] = .125;
    assert.deepEqual(response.live[0], expected);
    assert.deepEqual(response.live[0], response.live[1], 'centered mono remains centered through serial Slapback and Chorus');
    render(native, Math.ceil(boundary) - native.processedFrames - 1, 0); assert.equal(backup().activity, 'live');
    render(native, 1, 1); assert.notEqual(backup().activity, 'live');
    const tail = render(native, 401, 0);
    assert.deepEqual(tail.live[0].slice(0, 400), expected);
    assert.equal(tail.live[0][400], 0);
    assert.equal(backup().activity, 'standby');
    until(native, 1, 2, 0); native.events();
    const observedFrame = native.processedFrames;
    native.control({ id: 'knob', value: -3 }, 'rotation/2');
    const observation = native.events().find(event => event.type === 'control');
    assert.equal(observation?.frame, observedFrame); assert.equal(observation?.sampleRate, 8000);
    assert.deepEqual(observation?.control, { id: 'knob', value: -3 }); assert.equal(observation?.applied, true);
    assert.equal(observation?.commandId, 'rotation/2');
    assert.equal(backup().rotationEligible, false); assert.notEqual(backup().activity, 'live');
    until(native, 2, 1, 0); native.control({ id: 'knob', value: 2 }, 'rotation/3'); render(native, 500, 0);
    const before = backup().rotationRemainingBeats;
    native.control({ id: 'knob', value: 2 }, 'rotation/3'); native.control({ id: 'knob', value: 0 }, 'rotation/4');
    assert.equal(backup().rotationRemainingBeats, before, 'replayed producer command and zero delta do not extend the grid deadline');
    native.stop();
    assert.equal(backup().rotationRemainingBeats, 0);
    assert(render(native, 512, 1).live.every(channel => channel.every(value => value === 0)));
  } finally { native.dispose(); }
});

test('WASM rejects old duration packets instead of treating their field as a release grid', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
  const native = engine(program);
  try {
    const before = native.state();
    assert.throws(() => native.configureCompiled(program.map((field, index) => index === 1 ? 3 : field)), /compiled/i);
    assert.equal(native.state().phase, before.phase);
    assert.equal(native.state().startBar, before.startBar);
    assert.throws(() => new NativePerformance({
      api: { ...native.api, pf_abi_version: () => 5 }, sampleRate: 8000,
    }), /ABI mismatch/, 'the browser bridge rejects an old binary before creating another engine');
  } finally { native.dispose(); }
});

for (const rate of [44100, 48000]) for (const beats of [4, 6]) {
  test(`WASM quarter grid uses processed frames and fresh movement at the deadline (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true); native.start({ runId: `quarter-grid-${rate}-${beats}`, bpm: 120, countInBars: 0, endBar: 4, loop: false });
      const advanceTo = (frame: number) => render(native, frame - native.processedFrames, 0);
      advanceTo(Math.ceil(rate / 2) + 8);
      const anchor = native.query('pf_snapshot')[PF.CLOCK_BEAT_FRAME], framesPerBeat = rate / 2;
      const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
      advanceTo(Math.ceil(anchor + .1 * framesPerBeat));
      native.control({ id: 'knob', value: 4 }, 'first');
      const deadline = native.processedFrames + backup().rotationRemainingBeats * framesPerBeat;
      assert(Math.abs(deadline - (anchor + .25 * framesPerBeat)) < 1e-6);
      advanceTo(Math.ceil(anchor + .2 * framesPerBeat));
      native.control({ id: 'knob', value: -2 }, 'second');
      assert(Math.abs(native.processedFrames + backup().rotationRemainingBeats * framesPerBeat - deadline) < 1e-6,
        'motion within the same quarter does not add another quarter of inactivity');
      const boundary = Math.ceil(deadline);
      advanceTo(boundary - 1); assert.equal(backup().activity, 'live');
      advanceTo(boundary); assert.notEqual(backup().activity, 'live');
      native.control({ id: 'knob', value: -2 }, 'second');
      native.control({ id: 'knob', value: 0 }, 'zero');
      assert.notEqual(backup().activity, 'live', 'duplicate and zero cannot rearm expired rotation');
      native.control({ id: 'knob', value: -3 }, 'at-boundary');
      assert.equal(backup().activity, 'live');
      assert(Math.abs(native.processedFrames + backup().rotationRemainingBeats * framesPerBeat
        - (anchor + .5 * framesPerBeat)) < 1e-6, 'fresh movement at the processed boundary selects the following quarter');
      native.stop(); assert.equal(backup().rotationRemainingBeats, 0);
    } finally { native.dispose(); }
  });

  test(`WASM quarter-grid deadline follows a native tempo hit (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true); native.start({ runId: `quarter-grid-${rate}-${beats}`, bpm: 120, countInBars: 0, endBar: 4, loop: false });
      native.control({ id: 'tempo' }, 'tempo-first');
      const advanceTo = (frame: number) => render(native, frame - native.processedFrames, 0);
      advanceTo(Math.round(rate * .525)); native.control({ id: 'knob', value: 1 }, 'motion');
      advanceTo(Math.round(rate * .55));
      const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
      const remaining = backup().rotationRemainingBeats;
      native.control({ id: 'tempo' }, 'tempo-second');
      assert(Math.abs(backup().rotationRemainingBeats - remaining) < 1e-9);
      const bpm = native.state().bpm;
      assert(bpm < 120 && bpm > 100);
      const deadline = Math.ceil(native.processedFrames + remaining * rate * 60 / bpm);
      advanceTo(Math.ceil(rate * .625)); assert.equal(backup().activity, 'live', 'old wall-clock deadline cannot stop the new tempo early');
      advanceTo(deadline - 1); assert.equal(backup().activity, 'live');
      advanceTo(deadline); assert.notEqual(backup().activity, 'live');
    } finally { native.dispose(); }
  });
}

test('DYC missing Bing Bong finish matches the written finish through bar 10 beat 3 and later playback', async () => {
  const { default: song } = await import('../../../songs/dance-yrself-clean.js');
  assert(song.compiled?.executable);
  const program = Array.from(encodeCompiledProgram(song.compiled));
  for (const rate of [44100, 48000]) {
    const dry = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] }));
    const manual = engine(program, rate, dry);
    const automatic = engine(program, rate, dry);
    const framesPerCount = rate * 60 / song.chart.bpm;
    const plan = song.compiled.cues.filter(cue => cue.bar <= 13).map(cue => ({
      frame: cue.bar === 0 ? 1 : Math.ceil((5 + (cue.bar - 1) * 4 + (cue.cueBeat ?? 0)) * framesPerCount) + 1,
      cue,
    }));
    let next = 0;
    try {
      for (const native of [manual, automatic]) {
        native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
        native.setMicrophone(true);
        native.start({ runId: 'dyc-endpoint', bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: 14, loop: false });
      }
      const end = Math.ceil(58 * framesPerCount);
      for (let frame = 0; frame < end;) {
        while (next < plan.length && plan[next].frame === frame) {
          const { cue } = plan[next++];
          manual.control({ id: cue.buttonId });
          if (cue.source.a1 !== 'J21') automatic.control({ id: cue.buttonId });
        }
        const count = Math.min(128, end - frame, next < plan.length ? plan[next].frame - frame : 128);
        const source = (position: number) => Math.sin(position * .017) * .2;
        const written = render(manual, count, source);
        const missed = render(automatic, count, source);
        assert.deepEqual(missed.mixed, written.mixed, `${rate} Hz sample output preserves both layers after missed J21`);
        assert.deepEqual(missed.live, written.live, `${rate} Hz live routing preserves the written END handoff`);
        assert(!missed.events.some(event => event.type === 'fault'), 'missing a finish never faults the transport');
        frame += count;
      }
      const bing = automatic.compiledTake(3);
      assert.equal(bing.ready, true);
      assert(Math.abs(bing.frames - 6 * framesPerCount) <= 1, 'source capture ends at bar 8 beat 3');
      assert.equal(bing.period, Math.ceil(8 * framesPerCount), 'two silent-source counts complete the original two-bar phrase');
      assert.equal(automatic.state().phase, 'playing', 'the original bar 10 beat 3 failure point is safely passed');
      assert.equal(automatic.state().error, null);
      assert.equal(automatic.state().recording, null, 'all authorized cowbell bars also finish before later playback');
    } finally { manual.dispose(); automatic.dispose(); }
  }
});

test('DYC short practice loops discard unfinished source spans instead of overflowing across wraps', async () => {
  const { default: song } = await import('../../../songs/dance-yrself-clean.js');
  assert(song.compiled?.executable);
  for (const endBar of [1, 7]) {
    const rate = 8000;
    const native = engine(Array.from(encodeCompiledProgram(song.compiled)), rate);
    const framesPerCount = rate * 60 / song.chart.bpm;
    const cells = endBar === 1 ? ['B18'] : ['B18', 'D18', 'F18', 'F21', 'H21'];
    const plan = song.compiled.cues.filter(cue => cells.includes(cue.source.a1)).map(cue => ({
      frame: cue.bar === 0 ? 1 : Math.ceil((5 + (cue.bar - 1) * 4 + (cue.cueBeat ?? 0)) * framesPerCount) + 1,
      cue,
    }));
    let next = 0;
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true);
      native.start({ runId: `short-loop-${endBar}`, bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar, loop: true });
      for (let frame = 0; frame < rate * 35;) {
        while (next < plan.length && plan[next].frame === frame) native.control({ id: plan[next++].cue.buttonId });
        const count = Math.min(128, next < plan.length ? plan[next].frame - frame : 128);
        const block = render(native, count);
        assert(!block.events.some(event => event.type === 'fault'), 'crossing a selected loop boundary cannot orphan capture');
        frame += count;
      }
      assert.equal(native.state().phase, 'playing');
      assert.equal(native.state().error, null);
      assert.equal(native.state().recording, null);
      assert.equal(native.compiledTake(endBar === 1 ? 0 : 3).ready, false, 'incomplete prefix never becomes a published take');
      if (endBar === 7) assert(native.compiledTake(2).ready, 'earlier complete Bing Bong layer survives the truncated replacement');
    } finally { native.dispose(); }
  }
});
